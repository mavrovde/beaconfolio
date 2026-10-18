"""Tests for the standalone importer (spec 06). Mocked HTTP — no live LinkedIn/prod."""

import json
from pathlib import Path
from urllib.parse import parse_qs

import httpx
import pytest

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


# English posts shaped like the six real ones the old single-hit heuristic
# tagged "de" (ids 9, 66, 70, 71, 79, 80): each carries exactly the isolated
# German-looking token that tripped it.
_ENGLISH_WITH_GERMAN_TOKENS = [
    # "MIT" matched \bmit\b case-insensitively (both Margaret Hamilton posts).
    "Today we honor Margaret Hamilton. As director of the Software Engineering "
    "Division of the MIT Instrumentation Lab for Apollo, she coined the term.",
    # an umlaut in a city name
    'What if the interface to Germany\'s transport data was simply a '
    'conversation? Ask "Cheapest E10 in Köln?" and it is ranked by price.',
    # "der" + "ß" in a quoted name
    "Aachen, AI, and the systems we underestimate. The plaque read: Karl der "
    "Große. With my German at the time, my only idea was that it is old.",
    # an umlaut in a court name
    "On March 10, the Munich District Court (Landgericht München I) issued a "
    "landmark ruling that the disclaimers protecting businesses are not enough.",
    # the English verb "die"
    "Hyped consumer apps are born and die by the hundreds, but cloud bills and "
    "the people who pay them remain with us for years.",
    # mostly English with a short German quote: the German hits are real, but
    # English outnumbers them, so English wins.
    "Proud to announce: Wir sind jetzt auch in Köln! The team and I are excited "
    "to be there for you.",
]


@pytest.mark.parametrize("text", _ENGLISH_WITH_GERMAN_TOKENS)
def test_english_post_with_isolated_german_token_stays_english(text):
    assert detect_language(text) == "en"
    # Decisive English evidence beats a German default, too.
    assert detect_language(text, default="de") == "en"


@pytest.mark.parametrize(
    "text",
    [
        "Heute habe ich einen neuen Artikel über Softwarearchitektur und KI "
        "geschrieben. Es geht um die Frage, wie wir Systeme bauen, die auch in "
        "zehn Jahren noch wartbar sind.",
        "Ich freue mich sehr!",
        "Große Neuigkeiten: wir sind jetzt auch in Köln und München vertreten.",
    ],
)
def test_genuine_german_is_still_detected(text):
    assert detect_language(text) == "de"
    assert detect_language(text, default="en") == "de"


@pytest.mark.parametrize(
    "text",
    [
        "Danke an alle",  # too short to classify
        "Ich bin hier",  # German, but under the minimum word count
        "Kubernetes Terraform Grafana und",  # a single German hit is not enough
        # two German hits, but under the minimum share of the text
        "Kubernetes, Terraform, Grafana, Prometheus, Ansible, Docker, Helm, "
        "ArgoCD, Vault, Consul, Nomad, Packer, Jenkins, Gradle, Maven, Spark, "
        "Kafka, Flink, Redis, Postgres und Elastic und Kibana",
        "Köln",  # one umlaut word is not evidence
        "Kubernetes Terraform Grafana Prometheus Ansible",  # no function words
    ],
)
def test_short_or_ambiguous_text_returns_default(text):
    assert detect_language(text, default="en") == "en"
    assert detect_language(text, default="de") == "de"


def test_import_redetects_language_ignoring_stale_scraper_tag(tmp_path):
    """An export written by the old scraper heuristic carries a wrong "de";
    the importer must send what the CONTENT says, not the stale tag."""
    sent = []

    def handler(request: httpx.Request) -> httpx.Response:
        sent.append(request.content.decode("utf-8", "replace"))
        return httpx.Response(200, json={"id": 1, "slug": "s", "created": True})

    post = {
        "urn": "urn:li:activity:71",
        "content": _ENGLISH_WITH_GERMAN_TOKENS[0],
        "postedAt": "2026-07-01T10:00:00Z",
        "language": "de",
    }
    cfg = _cfg(tmp_path, posts=[post])
    with httpx.Client(transport=httpx.MockTransport(handler)) as client:
        assert core.import_one(client, cfg, post, Ledger(cfg.state_path)) == "created"
    assert len(sent) == 1
    # No image -> a plain urlencoded form body.
    assert parse_qs(sent[0])["language"] == ["en"]


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
