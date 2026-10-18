"""Security guards of the importer: image-origin allowlist (SSRF + session-cookie
leak), working-directory confinement of the env-named files (path traversal),
and log-line escaping (log injection). Mocked HTTP only — no live LinkedIn.

Each assertion is on the SEAM: which requests the transport actually received
(and with which cookie), which path `Config` will open, which text the log
record carries — not just the function's return value.
"""

import json
import logging
import os
from pathlib import Path

import httpx
import pytest

from importer import __main__ as cli
from importer import core
from importer.core import Config, Ledger, UnsafePathError, confine_to_workdir

GOOD = "https://media.licdn.com/dms/image/v2/post.jpg"


def _cfg(tmp_path: Path, **over) -> Config:
    pj = tmp_path / "posts_data.json"
    pj.write_text("[]")
    return Config(
        api_url="http://test",
        token="tok",
        posts_json=pj,
        state_path=tmp_path / "state.json",
        backoff=0.0,
        retries=1,
        li_at="SESSION-COOKIE",
        **over,
    )


def _recording_transport(routes: dict[str, httpx.Response]):
    seen: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        return routes.get(str(request.url), httpx.Response(404))

    return httpx.MockTransport(handler), seen


def _image(body: bytes = b"IMG") -> httpx.Response:
    return httpx.Response(200, content=body, headers={"content-type": "image/jpeg"})


# --- SSRF / cookie leak -----------------------------------------------------


@pytest.mark.parametrize(
    "url",
    [
        GOOD.replace("https:", "http:", 1),  # same URL, downgraded to plain http
        "https://media.licdn.com.evil.example/x.jpg",  # suffix lookalike
        "https://media.licdn.com@evil.example/x.jpg",  # userinfo trick
        "https://evil.example/https://media.licdn.com/x.jpg",
        "http://169.254.169.254/latest/meta-data/",  # cloud metadata
        "http://localhost:8000/api/app/admin/sql/backup",
        "file:///etc/passwd",
        # right host, but a path outside the media tree or one that climbs out
        "https://media.licdn.com/voyager/api/me",
        "https://media.licdn.com/dms/image/../../voyager/api/me",
        "https://media.licdn.com/dms/image/%2e%2e/%2e%2e/voyager/api/me",
        "https://media.licdn.com/dms/image/v2/a%2Fb.jpg",
    ],
)
def test_off_origin_image_url_is_never_requested(tmp_path, url, caplog):
    transport, seen = _recording_transport({url: _image()})
    with (
        caplog.at_level(logging.WARNING, logger="importer"),
        httpx.Client(transport=transport) as client,
    ):
        assert core.download_image(client, url, _cfg(tmp_path)) is None
    assert seen == []  # no request at all, so the session cookie went nowhere
    assert any(
        "not a https://media.licdn.com/dms/image/ path" in r.getMessage()
        for r in caplog.records
    )


def test_a_real_shaped_signed_url_is_requested_unchanged(tmp_path):
    """Rebuilding the request must not alter a real export URL (path + signed query)."""
    real = (
        "https://media.licdn.com/dms/image/sync/v2/D4D27AQH-x_1/articleshare-shrink_480"
        "/B4DaCpD-/0/1789542651374?e=1792918800&v=beta&t=Ab-_9xYz"
    )
    transport, seen = _recording_transport({real: _image(b"REAL")})
    with httpx.Client(transport=transport) as client:
        assert core.download_image(client, real, _cfg(tmp_path)) == (
            b"REAL",
            "image/jpeg",
        )
    assert [str(r.url) for r in seen] == [real]


def test_allowed_image_is_fetched_with_the_session_cookie(tmp_path):
    transport, seen = _recording_transport({GOOD: _image(b"BYTES")})
    with httpx.Client(transport=transport) as client:
        assert core.download_image(client, GOOD, _cfg(tmp_path)) == (
            b"BYTES",
            "image/jpeg",
        )
    assert [str(r.url) for r in seen] == [GOOD]
    assert "li_at=SESSION-COOKIE" in seen[0].headers.get("cookie", "")


def test_redirect_off_origin_is_not_followed(tmp_path):
    routes = {
        GOOD: httpx.Response(302, headers={"location": "http://169.254.169.254/"}),
        "http://169.254.169.254/": _image(),
    }
    transport, seen = _recording_transport(routes)
    with httpx.Client(transport=transport) as client:
        assert core.download_image(client, GOOD, _cfg(tmp_path)) is None
    assert [str(r.url) for r in seen] == [GOOD]


def test_redirect_on_origin_is_followed(tmp_path):
    target = "https://media.licdn.com/dms/image/v2/final.jpg"
    routes = {
        GOOD: httpx.Response(301, headers={"location": "/dms/image/v2/final.jpg"}),
        target: _image(b"FINAL"),
    }
    transport, seen = _recording_transport(routes)
    with httpx.Client(transport=transport) as client:
        assert core.download_image(client, GOOD, _cfg(tmp_path)) == (
            b"FINAL",
            "image/jpeg",
        )
    assert [str(r.url) for r in seen] == [GOOD, target]


def test_redirect_loop_is_bounded(tmp_path, caplog):
    routes = {GOOD: httpx.Response(302, headers={"location": GOOD})}
    transport, seen = _recording_transport(routes)
    with (
        caplog.at_level(logging.WARNING, logger="importer"),
        httpx.Client(transport=transport) as client,
    ):
        assert core.download_image(client, GOOD, _cfg(tmp_path)) is None
    assert len(seen) == core._MAX_IMAGE_REDIRECTS + 1
    assert any("too many redirects" in r.getMessage() for r in caplog.records)


# --- path confinement -------------------------------------------------------


def test_paths_inside_the_workdir_are_returned_relative(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    assert confine_to_workdir("scraper/posts_data.json", "X") == Path(
        "scraper/posts_data.json"
    )
    assert confine_to_workdir(str(tmp_path / "a" / "b.json"), "X") == Path("a/b.json")
    assert confine_to_workdir("scraper/../importer/s.json", "X") == Path(
        "importer/s.json"
    )


@pytest.mark.parametrize(
    "raw", ["../outside.json", "scraper/../../outside.json", "/etc/passwd"]
)
def test_paths_outside_the_workdir_are_refused(tmp_path, monkeypatch, raw):
    work = tmp_path / "work"
    work.mkdir()
    monkeypatch.chdir(work)
    with pytest.raises(UnsafePathError, match="outside the working directory"):
        confine_to_workdir(raw, "POSTS_JSON")


def test_a_symlink_pointing_out_of_the_workdir_is_refused(tmp_path, monkeypatch):
    work = tmp_path / "work"
    work.mkdir()
    secret = tmp_path / "secret.json"
    secret.write_text("{}")
    os.symlink(secret, work / "posts_data.json")
    monkeypatch.chdir(work)
    with pytest.raises(UnsafePathError):
        confine_to_workdir("posts_data.json", "POSTS_JSON")


def test_from_env_confines_both_env_named_files(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    monkeypatch.setenv("POSTS_JSON", "../stolen.json")
    with pytest.raises(UnsafePathError, match="POSTS_JSON"):
        Config.from_env()
    monkeypatch.setenv("POSTS_JSON", "scraper/posts_data.json")
    monkeypatch.setenv("IMPORT_STATE", str(tmp_path.parent / "overwrite-me.json"))
    with pytest.raises(UnsafePathError, match="IMPORT_STATE"):
        Config.from_env()


def test_cli_refuses_to_start_on_an_unsafe_path(tmp_path, monkeypatch, caplog):
    monkeypatch.chdir(tmp_path)
    monkeypatch.setenv("POSTS_JSON", "../stolen.json")
    monkeypatch.setenv("LINKEDIN_IMPORT_TOKEN", "tok")

    def _must_not_run(_cfg):  # pragma: no cover - asserted below
        raise AssertionError("run() must not be reached")

    monkeypatch.setattr(cli, "run", _must_not_run)
    with caplog.at_level(logging.ERROR):
        assert cli.main([]) == 2
    assert any("refusing to start" in r.getMessage() for r in caplog.records)


# --- log injection ----------------------------------------------------------


FORGED = "urn:li:activity:9\n2026-01-01 INFO created: urn=urn:li:activity:0\x1b[2J"


def test_log_safe_escapes_line_breaks_and_controls():
    assert core._log_safe("a\r\nb") == "a\\r\\nb"
    assert core._log_safe("x\x1b[2J\x00\x7f") == "x\\x1b[2J\\x00\\x7f"
    assert core._log_safe("Köln urn:li:activity:1") == "Köln urn:li:activity:1"


def test_import_one_log_lines_cannot_be_forged(tmp_path, caplog):
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(500, text="boom\nINFO created: urn=fake")

    cfg = _cfg(tmp_path)
    post = {"urn": FORGED, "content": "Hello there friends of the blog"}
    ledger = Ledger(tmp_path / "state.json")
    with (
        caplog.at_level(logging.INFO, logger="importer"),
        httpx.Client(transport=httpx.MockTransport(handler)) as client,
    ):
        assert core.import_one(client, cfg, post, ledger) == "failed"
        ledger.mark(FORGED, core.post_fingerprint(post))
        assert core.import_one(client, cfg, post, ledger) == "skipped"
    importer_lines = [r.getMessage() for r in caplog.records if r.name == "importer"]
    assert len(importer_lines) == 2
    for line in importer_lines:
        assert "\n" not in line and "\x1b" not in line
        assert "urn:li:activity:9\\n2026-01-01" in line
    assert "boom\\nINFO" in importer_lines[0]


def test_dry_run_and_success_log_lines_are_escaped(tmp_path, caplog):
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"created": True})

    post = {"urn": FORGED, "content": "Hello there friends of the blog"}
    with (
        caplog.at_level(logging.INFO, logger="importer"),
        httpx.Client(transport=httpx.MockTransport(handler)) as client,
    ):
        core.import_one(
            client, _cfg(tmp_path, dry_run=True), post, Ledger(tmp_path / "a")
        )
        core.import_one(client, _cfg(tmp_path), post, Ledger(tmp_path / "b"))
    lines = [r.getMessage() for r in caplog.records if r.name == "importer"]
    assert len(lines) == 2 and all("\n" not in line for line in lines)


def test_transport_error_log_line_is_escaped(tmp_path, caplog):
    def handler(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("refused\nforged")

    with (
        caplog.at_level(logging.WARNING, logger="importer"),
        httpx.Client(transport=httpx.MockTransport(handler)) as client,
    ):
        assert core.download_image(client, GOOD, _cfg(tmp_path)) is None
    (line,) = [r.getMessage() for r in caplog.records if r.name == "importer"]
    assert "\n" not in line and "refused\\nforged" in line


def test_load_posts_still_reads_a_confined_relative_path(tmp_path, monkeypatch):
    """Regression: confinement returns a RELATIVE path that the loader opens."""
    monkeypatch.chdir(tmp_path)
    (tmp_path / "scraper").mkdir()
    (tmp_path / "scraper" / "posts_data.json").write_text(
        json.dumps([{"urn": "u", "content": "c"}])
    )
    monkeypatch.delenv("POSTS_JSON", raising=False)
    monkeypatch.delenv("SCRAPER_DIR", raising=False)
    cfg = Config.from_env()
    assert cfg.posts_json == Path("scraper/posts_data.json")
    assert core.load_posts(cfg) == [{"urn": "u", "content": "c"}]
