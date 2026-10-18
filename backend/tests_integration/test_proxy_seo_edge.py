"""SEO-relevant behaviour of the composed proxy hop (rule 12).

None of this is visible below the proxy: the ASGI test client has no nginx in front of it.
Three things are pinned here, all measured broken on the live site before this change:

* responses are COMPRESSED even when the request carries the ``Via`` header that the host
  edge adds (nginx's ``gzip_proxied`` default refuses to compress those);
* an alias hostname (``www.<domain>``) 301-redirects to the canonical host instead of
  serving a duplicate copy of the site;
* the public site sends the transport/privacy headers.

The canonical/alias pair comes from ``PUBLIC_SERVER_NAME`` (first name = canonical); the
composed stack's default is ``beaconfolio.com www.beaconfolio.com``.
"""

import httpx

from conftest import PUBLIC_URL

CANONICAL = "beaconfolio.com"
ALIAS = "www.beaconfolio.com"


def test_html_is_gzipped_behind_the_host_edge(client: httpx.Client):
    """Mutation-check: drop `gzip_proxied any` and the Via request header disables gzip."""
    resp = client.get(
        f"{PUBLIC_URL}/",
        headers={"Via": "1.1 Caddy", "Accept-Encoding": "gzip"},
    )
    assert resp.status_code == 200, resp.text[:200]
    assert resp.headers.get("content-encoding") == "gzip", dict(resp.headers)
    assert "accept-encoding" in resp.headers.get("vary", "").lower()


def test_alias_host_redirects_permanently_to_the_canonical_host(client: httpx.Client):
    resp = client.get(
        f"{PUBLIC_URL}/blog?page=2",
        headers={"Host": ALIAS},
        follow_redirects=False,
    )
    assert resp.status_code == 301, (resp.status_code, resp.text[:200])
    assert resp.headers["location"] == f"https://{CANONICAL}/blog?page=2"


def test_public_site_sends_transport_and_privacy_headers(client: httpx.Client):
    resp = client.get(f"{PUBLIC_URL}/")
    assert resp.headers["strict-transport-security"].startswith("max-age=")
    assert resp.headers["referrer-policy"] == "strict-origin-when-cross-origin"
    # The contact page records voice messages, so the microphone must stay usable.
    assert "microphone=(self)" in resp.headers["permissions-policy"]
