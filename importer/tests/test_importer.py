"""Tests for the standalone importer (spec 06). Mocked HTTP — no live LinkedIn/prod."""

import json
from pathlib import Path

import httpx

from importer import core
from importer.core import (
    Config,
    Ledger,
    detect_language,
    load_posts,
    post_fingerprint,
    run,
)

POSTS = [
    {
        "urn": "urn:li:activity:2",
        "content": "Newer post about engineering.",
        "imageUrl": "https://media.licdn.com/dms/image/post2.jpg",
        "imageUrls": ["https://media.licdn.com/dms/image/post2.jpg"],
        "postedAt": "2026-07-05T10:00:00Z",
        "url": "https://www.linkedin.com/feed/update/urn:li:activity:2/",
        "language": "en",
    },
    {
        "urn": "urn:li:activity:1",
        "content": "Older post, no image.",
        "postedAt": "2026-07-01T10:00:00Z",
        "url": "https://www.linkedin.com/feed/update/urn:li:activity:1/",
    },
]


def _cfg(tmp_path: Path, posts=POSTS, **over) -> Config:
    pj = tmp_path / "posts_data.json"
    pj.write_text(json.dumps(posts))
    return Config(
        api_url="http://test",
        token="tok",
        posts_json=pj,
        state_path=tmp_path / "state.json",
        backoff=0.0,
        retries=2,
        **over,
    )


def _transport(status=200, created=True):
    calls = {"posts": [], "images": []}

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path.endswith("/import-post"):
            calls["posts"].append(str(request.url))
            if status >= 500:
                return httpx.Response(status, text="server error")
            return httpx.Response(
                200, json={"id": len(calls["posts"]), "slug": "s", "created": created}
            )
        calls["images"].append(str(request.url))
        return httpx.Response(
            200, content=b"IMGBYTES", headers={"content-type": "image/jpeg"}
        )

    return httpx.MockTransport(handler), calls


# --- unit ------------------------------------------------------------------


def test_detect_language():
    assert detect_language("Das ist für mich nicht gut") == "de"
    assert detect_language("This is english") == "en"
    assert detect_language("", default="en") == "en"


def test_fingerprint_stable_and_content_sensitive():
    a = {"content": "x", "imageUrl": "u", "imageUrls": ["u"]}
    assert post_fingerprint(a) == post_fingerprint(dict(a))
    assert post_fingerprint(a) != post_fingerprint({**a, "content": "y"})


def test_load_posts_sorts_oldest_first_and_drops_empty(tmp_path):
    posts = POSTS + [{"urn": "x", "content": "  "}]  # empty content dropped
    cfg = _cfg(tmp_path, posts=posts)
    loaded = load_posts(cfg)
    assert [p["urn"] for p in loaded] == ["urn:li:activity:1", "urn:li:activity:2"]


def test_ledger_roundtrip(tmp_path):
    led = Ledger(tmp_path / "s.json")
    assert not led.unchanged("u", "fp")
    led.mark("u", "fp")
    led.save()
    assert Ledger(tmp_path / "s.json").unchanged("u", "fp")


# --- run -------------------------------------------------------------------


def test_run_imports_each_post_once(tmp_path):
    transport, calls = _transport()
    with httpx.Client(transport=transport) as client:
        summary = run(_cfg(tmp_path), client=client)
    assert summary.created == 2 and summary.failed == 0
    assert len(calls["posts"]) == 2
    assert len(calls["images"]) == 1  # only the post that had an imageUrl


def test_retry_then_failed_continues(tmp_path):
    transport, calls = _transport(status=500)
    with httpx.Client(transport=transport) as client:
        summary = run(_cfg(tmp_path), client=client)
    # every post retried `retries` times, batch still completes, reported as failed
    assert summary.failed == 2 and summary.ok is False
    assert len(calls["posts"]) == 2 * 2  # 2 posts × 2 attempts


def test_idempotent_second_run(tmp_path):
    cfg = _cfg(tmp_path)
    transport, calls = _transport()
    with httpx.Client(transport=transport) as client:
        run(cfg, client=client)
    first = len(calls["posts"])
    # second run over the same input + persisted ledger imports nothing new
    with httpx.Client(transport=transport) as client:
        summary2 = run(cfg, client=client)
    assert first == 2
    assert len(calls["posts"]) == first  # no new POSTs
    assert summary2.skipped == 2 and summary2.created == 0


def test_dry_run_posts_nothing(tmp_path):
    transport, calls = _transport()
    with httpx.Client(transport=transport) as client:
        summary = run(_cfg(tmp_path, dry_run=True), client=client)
    assert calls["posts"] == [] and calls["images"] == []
    assert summary.skipped == 2
    assert not (tmp_path / "state.json").exists()  # ledger not written on dry-run


def test_publish_flag_sends_true(tmp_path):
    seen = {}

    def handler(request):
        if request.url.path.endswith("/import-post"):
            seen["published"] = (
                b'name="published"\r\n\r\ntrue' in request.content
                or b"published=true" in request.content
            )
            return httpx.Response(200, json={"created": True})
        return httpx.Response(200, content=b"x", headers={"content-type": "image/jpeg"})

    with httpx.Client(transport=httpx.MockTransport(handler)) as client:
        run(_cfg(tmp_path, posts=[POSTS[1]], publish=True), client=client)
    assert seen.get("published") is True


# --- per-target ledger (#334) ----------------------------------------------
# One global state.json meant the ledger remembered THAT a post was imported
# but not WHERE TO: a fresh server got 21 of 25 posts silently skipped
# (measured 2026-09-10). The default path is now derived from the target host.


def test_default_state_path_is_per_target():
    a = core.default_state_path("https://a.example.com")
    b = core.default_state_path("https://b.example.com")
    assert a != b
    assert a == Path("importer/state.a.example.com.json")
    # host:port targets stay legal filenames
    assert core.default_state_path("http://localhost:8000") == Path(
        "importer/state.localhost-8000.json"
    )
    # unparseable target still yields a usable path, not a crash
    assert core.default_state_path("") == Path("importer/state.local.json")


def test_from_env_derives_ledger_from_target(monkeypatch):
    monkeypatch.setenv("BEACONFOLIO_API_URL", "https://new.example.com")
    monkeypatch.delenv("IMPORT_STATE", raising=False)
    cfg = Config.from_env()
    assert cfg.state_path == Path("importer/state.new.example.com.json")


def test_from_env_import_state_overrides(monkeypatch):
    monkeypatch.setenv("BEACONFOLIO_API_URL", "https://new.example.com")
    monkeypatch.setenv("IMPORT_STATE", "custom/ledger.json")
    cfg = Config.from_env()
    assert cfg.state_path == Path("custom/ledger.json")


def test_two_target_sequence_imports_fully_to_second_target(tmp_path, monkeypatch):
    """Import to A, then point at B: B must get a FULL import, not skips."""
    monkeypatch.chdir(tmp_path)
    counts = {"posts": 0}

    def handler(request):
        if request.url.path.endswith("/import-post"):
            counts["posts"] += 1
            return httpx.Response(200, json={"created": True})
        return httpx.Response(200, content=b"x", headers={"content-type": "image/jpeg"})

    def cfg_for(target):
        pj = tmp_path / "posts_data.json"
        pj.write_text(json.dumps(POSTS))
        return Config(
            api_url=target,
            token="tok",
            posts_json=pj,
            state_path=core.default_state_path(target),
            backoff=0.0,
            retries=2,
        )

    with httpx.Client(transport=httpx.MockTransport(handler)) as client:
        s1 = run(cfg_for("https://a.example.com"), client=client)
        assert (s1.created, s1.skipped) == (2, 0)
        # same target again: ledger still saves the round-trips
        s2 = run(cfg_for("https://a.example.com"), client=client)
        assert (s2.created, s2.skipped) == (0, 2)
        # NEW target: nothing may be skipped by A's memory
        s3 = run(cfg_for("https://b.example.com"), client=client)
        assert (s3.created, s3.skipped) == (2, 0)
    assert counts["posts"] == 4


def test_legacy_global_ledger_is_ignored_with_a_note(tmp_path, monkeypatch, caplog):
    """A pre-#334 importer/state.json must not feed skip decisions."""
    monkeypatch.chdir(tmp_path)
    legacy = tmp_path / "importer" / "state.json"
    legacy.parent.mkdir(parents=True)
    # legacy ledger claims BOTH posts are already imported
    legacy.write_text(
        json.dumps({p["urn"]: post_fingerprint(p) for p in POSTS})
    )

    def handler(request):
        if request.url.path.endswith("/import-post"):
            return httpx.Response(200, json={"created": True})
        return httpx.Response(200, content=b"x", headers={"content-type": "image/jpeg"})

    pj = tmp_path / "posts_data.json"
    pj.write_text(json.dumps(POSTS))
    cfg = Config(
        api_url="https://new.example.com",
        token="tok",
        posts_json=pj,
        state_path=core.default_state_path("https://new.example.com"),
        backoff=0.0,
        retries=2,
    )
    with caplog.at_level("INFO", logger="importer"), httpx.Client(
        transport=httpx.MockTransport(handler)
    ) as client:
        s = run(cfg, client=client)
    assert (s.created, s.skipped) == (2, 0)
    assert any("legacy ledger" in r.getMessage() for r in caplog.records)
    assert any(
        "ledger importer/state.new.example.com.json for target" in r.getMessage()
        for r in caplog.records
    )


# --- independence guard ----------------------------------------------------


def test_importer_has_no_agents_dependency():
    import re

    root = Path(core.__file__).resolve().parent
    pat = re.compile(r"^\s*(import agents|from agents)\b", re.M)
    for py in root.rglob("*.py"):
        if "tests" in py.parts:  # don't scan the test files themselves
            continue
        assert not pat.search(py.read_text()), py
