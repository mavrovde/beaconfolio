"""Unit tests for app/api/conditional.py — the parts the posts routes cannot
reach (they always render valid JSON with a well-formed ``updated_at``)."""

import pytest
from starlette.requests import Request
from starlette.responses import JSONResponse, Response

from app.api.conditional import _last_modified, apply_validators, etag_matches


def _request(method: str = "GET", headers: dict[str, str] | None = None) -> Request:
    raw = [(k.lower().encode(), v.encode()) for k, v in (headers or {}).items()]
    return Request({"type": "http", "method": method, "headers": raw})


@pytest.mark.parametrize(
    "body,expected",
    [
        (b"not json", None),
        (b"[1, 2]", None),
        (b'{"items": [], "updated_at": "2026-01-01T00:00:00+00:00"}', None),
        (b'{"updated_at": 5}', None),
        (b'{"updated_at": "yesterday"}', None),
        (b'{"title": "no stamp"}', None),
        (
            b'{"updated_at": "2026-01-25T09:00:00+01:00"}',
            "Sun, 25 Jan 2026 08:00:00 GMT",
        ),
        # A naive stamp is read as UTC rather than local time.
        (b'{"updated_at": "2026-01-25T09:00:00"}', "Sun, 25 Jan 2026 09:00:00 GMT"),
    ],
)
def test_last_modified(body: bytes, expected: str | None):
    assert _last_modified(body) == expected


def test_etag_matches_empty_header():
    assert etag_matches(None, 'W/"x"') is False
    assert etag_matches("", 'W/"x"') is False


@pytest.mark.parametrize(
    "method,response",
    [
        ("POST", JSONResponse({"a": 1})),
        ("GET", JSONResponse({"detail": "nope"}, status_code=404)),
        ("GET", Response(b"png", media_type="image/png")),
    ],
    ids=["non_get", "non_200", "non_json"],
)
def test_untouched_responses(method: str, response: Response):
    out = apply_validators(_request(method, {"If-None-Match": "*"}), response)
    assert out is response
    assert "etag" not in out.headers


def test_matching_tag_becomes_304_without_body():
    first = apply_validators(_request(), JSONResponse({"a": 1}))
    tag = first.headers["etag"]
    second = apply_validators(
        _request(headers={"If-None-Match": tag}), JSONResponse({"a": 1})
    )
    assert second.status_code == 304
    assert second.body == b""
    assert second.headers["etag"] == tag
