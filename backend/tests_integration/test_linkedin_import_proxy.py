"""LinkedIn post import through the COMPOSED stack's proxy hop (rule 12).

The unit tier runs the ASGI app with no nginx in front, so it cannot see that the
public `/api/app/` location caps request bodies at 3 MB while
``IMPORT_MAX_IMAGE_MB`` allows a 10 MB post image. Importing a 3.8 MB LinkedIn
feed image through the public host therefore died with nginx's opaque HTML 413
before the app could answer. ``proxy/default.conf.template`` now gives this one
endpoint its own exact-match location with a larger limit.
"""

import httpx

from conftest import PUBLIC_URL

IMPORT_URL = f"{PUBLIC_URL}/api/app/linkedin/import-post"
PNG = b"\x89PNG\r\n\x1a\n"


def test_the_proxy_lets_the_import_endpoint_answer_for_its_own_image_cap(
    client: httpx.Client, admin_headers: dict[str, str]
):
    """An image just over the APP's 10 MB cap must be refused by the APP.

    The body is also well over the 3 MB public default, so this is the case that
    distinguishes the two layers: before the dedicated location nginx answered 413
    with an HTML body; now the endpoint answers with its structured JSON 413. An
    oversize image is rejected before anything is stored, so the stack gains no row.
    Mutation-check: delete the `location = /api/app/linkedin/import-post` block and
    the content-type assertion below fails.
    """
    oversize = PNG + b"\x00" * (10 * 1024 * 1024 + 1)
    resp = client.post(
        IMPORT_URL,
        headers=admin_headers,
        data={"content": "proxy body-limit probe", "urn": "urn:li:activity:1"},
        files={"image": ("probe.png", oversize, "image/png")},
        timeout=60.0,
    )
    assert resp.status_code == 413, resp.text
    assert resp.headers["content-type"].startswith("application/json"), resp.text[:200]
    assert "10 MB limit" in resp.json()["detail"], resp.text


def test_other_public_routes_keep_the_tight_default_cap(client: httpx.Client):
    """The larger limit is scoped to the import path, not the whole public API."""
    resp = client.post(
        f"{PUBLIC_URL}/api/app/interactions/voice",
        files={"audio": ("big.webm", b"\x00" * (4 * 1024 * 1024), "audio/webm")},
        data={"duration_s": "3"},
        timeout=60.0,
    )
    # nginx's own 413 (text/html): the 3m cap still applies here. Not 429/401 etc.
    assert resp.status_code == 413, resp.text[:200]
    assert resp.headers["content-type"].startswith("text/html"), resp.headers
