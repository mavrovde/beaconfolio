"""CORS is the OUTERMOST middleware (Sonar python:S8414).

Starlette's ``add_middleware`` prepends to ``app.user_middleware``, so index 0
is the outermost layer — the first to see a request and the last to touch the
response.

What can and cannot fail here, stated so nobody mistakes the header tests for
the pin:

* ``test_cors_is_the_outermost_middleware`` is THE regression test. Reverting
  the reorder in ``app/main.py`` (CORS added before ``ApiNoindexMiddleware``)
  puts ``ApiNoindexMiddleware`` at index 0 and this test fails.
* The two header tests pass in BOTH orders with today's middlewares:
  ``ApiNoindexMiddleware`` only appends a header, so wrapping it inside or
  outside CORS is not observable on the wire. They exist to pin the composed
  contract the order protects — a noindex-touched API response AND a preflight
  both carry CORS headers — so a future middleware that short-circuits or
  rewrites responses cannot silently strip them.
"""

from httpx import AsyncClient
from starlette.middleware.cors import CORSMiddleware

from app.config import settings
from app.main import app
from app.robots_header import ApiNoindexMiddleware

PREFIX = settings.api_prefix
ORIGIN = next(o.strip() for o in settings.cors_origins.split(",") if o.strip())


def test_cors_is_the_outermost_middleware():
    classes = [m.cls for m in app.user_middleware]
    assert classes[0] is CORSMiddleware, classes
    assert ApiNoindexMiddleware in classes[1:]


async def test_noindex_touched_response_carries_cors_headers(client: AsyncClient):
    r = await client.get(f"{PREFIX}/config/site", headers={"Origin": ORIGIN})
    assert r.status_code == 200
    # The noindex middleware DID touch this response …
    assert r.headers["x-robots-tag"] == "noindex"
    # … and CORS still decorated it.
    assert r.headers["access-control-allow-origin"] == ORIGIN
    assert r.headers["access-control-allow-credentials"] == "true"


async def test_preflight_is_answered_with_cors_headers(client: AsyncClient):
    r = await client.options(
        f"{PREFIX}/config/site",
        headers={
            "Origin": ORIGIN,
            "Access-Control-Request-Method": "POST",
            "Access-Control-Request-Headers": "content-type",
        },
    )
    assert r.status_code == 200
    assert r.headers["access-control-allow-origin"] == ORIGIN
    assert "POST" in r.headers["access-control-allow-methods"]
    assert "content-type" in r.headers["access-control-allow-headers"].lower()


async def test_disallowed_origin_gets_no_cors_grant(client: AsyncClient):
    r = await client.get(
        f"{PREFIX}/config/site", headers={"Origin": "https://evil.example"}
    )
    assert "access-control-allow-origin" not in r.headers
