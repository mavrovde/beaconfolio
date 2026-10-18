"""``X-Robots-Tag: noindex`` on API JSON, and its exemptions
(app/robots_header.py)."""

import pytest
from httpx import ASGITransport, AsyncClient
from starlette.responses import JSONResponse, PlainTextResponse, Response
from starlette.routing import Route

from app.config import settings
from app.models.post import Post
from app.robots_header import INDEXABLE_API_PATHS, ApiNoindexMiddleware

PREFIX = settings.api_prefix


async def test_api_json_is_noindex(client: AsyncClient):
    r = await client.get(f"{PREFIX}/config/site")
    assert r.status_code == 200
    assert r.headers["x-robots-tag"] == "noindex"


async def test_api_json_error_is_noindex_too(client: AsyncClient):
    r = await client.get(f"{PREFIX}/posts/does-not-exist")
    assert r.status_code == 404
    assert r.headers["x-robots-tag"] == "noindex"


async def test_post_image_stays_indexable(client: AsyncClient, db_session):
    post = Post(
        title="t",
        slug="img",
        content="c",
        language="en",
        published=True,
        tags=[],
        image_blob=b"\x89PNG",
        image_type="image/png",
    )
    db_session.add(post)
    await db_session.commit()
    r = await client.get(f"{PREFIX}/posts/{post.id}/image")
    assert r.status_code == 200
    assert "x-robots-tag" not in r.headers


def test_resume_json_is_the_documented_exemption():
    assert "/profile/resume.json" in INDEXABLE_API_PATHS


# --- the middleware in isolation (no app routes, no DB) -----------------------


def _app(response: Response) -> ApiNoindexMiddleware:
    from starlette.applications import Starlette

    async def endpoint(request):
        return response

    inner = Starlette(
        routes=[
            Route("/api/app/thing", endpoint),
            Route("/api/app/profile/resume.json", endpoint),
            Route("/elsewhere", endpoint),
        ]
    )
    return ApiNoindexMiddleware(inner, api_prefix="/api/app/")


async def _get(app, path: str):
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://t") as c:
        return await c.get(path)


@pytest.mark.parametrize(
    "path,response,expected",
    [
        ("/api/app/thing", JSONResponse({"a": 1}), "noindex"),
        ("/api/app/profile/resume.json", JSONResponse({"a": 1}), None),
        ("/elsewhere", JSONResponse({"a": 1}), None),
        ("/api/app/thing", PlainTextResponse("x"), None),
        (
            "/api/app/thing",
            JSONResponse({"a": 1}, headers={"X-Robots-Tag": "all"}),
            "all",
        ),
        (
            "/api/app/thing",
            Response(b"{}", media_type="application/json; charset=utf-8"),
            "noindex",
        ),
    ],
    ids=[
        "api_json",
        "resume_exempt",
        "outside_prefix",
        "non_json",
        "route_header_wins",
        "json_with_params",
    ],
)
async def test_middleware_matrix(path, response, expected):
    r = await _get(_app(response), path)
    assert r.headers.get("x-robots-tag") == expected


async def test_middleware_passes_non_http_scopes_through():
    seen = []

    async def inner(scope, receive, send):
        seen.append(scope["type"])

    mw = ApiNoindexMiddleware(inner, api_prefix="/api/app")
    await mw({"type": "lifespan"}, None, None)
    assert seen == ["lifespan"]
