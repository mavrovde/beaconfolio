"""Tests for the public site-config endpoint (#65)."""

import pytest
from httpx import AsyncClient

from app.config import settings


@pytest.mark.asyncio
async def test_site_config_returns_all_fields(client: AsyncClient):
    """Every identity field the frontend consumes must be present."""
    response = await client.get(f"{settings.api_prefix}/config/site")
    assert response.status_code == 200
    data = response.json()
    for field in (
        "site_name",
        "site_url",
        "owner_name",
        "owner_headline",
        "owner_description",
        "social_links",
        "analytics_id",
        "gtm_container_id",
    ):
        assert field in data, f"missing field: {field}"


@pytest.mark.asyncio
async def test_site_config_reflects_settings(client: AsyncClient, monkeypatch):
    """The payload is derived from Settings, not hardcoded — pinned by
    patching DISTINCT values (asserting equality with unmodified settings
    would also pass against a hardcoded copy of the defaults; #255 review
    mutation finding)."""
    monkeypatch.setattr(settings, "site_name", "pin-site")
    monkeypatch.setattr(settings, "owner_name", "Pin Owner")
    monkeypatch.setattr(settings, "owner_headline", "Pin Headline")
    monkeypatch.setattr(settings, "owner_description", "Pin description.")
    monkeypatch.setattr(settings, "analytics_id", "G-PIN00001")
    monkeypatch.setattr(settings, "gtm_container_id", "GTM-PIN0001")
    response = await client.get(f"{settings.api_prefix}/config/site")
    data = response.json()
    assert data["site_name"] == "pin-site"
    assert data["owner_name"] == "Pin Owner"
    assert data["owner_headline"] == "Pin Headline"
    assert data["owner_description"] == "Pin description."
    assert data["analytics_id"] == "G-PIN00001"
    assert data["gtm_container_id"] == "GTM-PIN0001"


@pytest.mark.asyncio
async def test_site_config_never_exposes_admin_email(client: AsyncClient):
    """admin_email doubles as the admin LOGIN USERNAME — it must never appear
    in this unauthenticated payload (#255 review finding 7)."""
    response = await client.get(f"{settings.api_prefix}/config/site")
    body = response.text
    assert "contact_email" not in body
    assert settings.admin_email not in body


def test_cors_allowlist_comes_from_settings(monkeypatch):
    """The middleware must be BUILT from settings.cors_origins — pinned by
    constructing the app with a distinct value and inspecting the installed
    CORSMiddleware (a value-equality check against defaults survives a
    hardcoded revert; #255 review mutation finding). Module reload is required
    because the middleware is wired at import time."""
    import importlib

    import app.main as main_module

    monkeypatch.setattr(settings, "cors_origins", "https://cors-pin.example")
    try:
        importlib.reload(main_module)
        cors = next(
            m for m in main_module.app.user_middleware if "CORSMiddleware" in str(m.cls)
        )
        assert cors.kwargs["allow_origins"] == ["https://cors-pin.example"]
    finally:
        monkeypatch.undo()
        importlib.reload(main_module)


@pytest.mark.asyncio
async def test_site_config_url_has_no_trailing_slash(client: AsyncClient, monkeypatch):
    """A trailing slash in SITE_URL must not leak into canonical URLs."""
    monkeypatch.setattr(settings, "site_url", "https://example.test/")
    response = await client.get(f"{settings.api_prefix}/config/site")
    assert response.json()["site_url"] == "https://example.test"


@pytest.mark.asyncio
async def test_site_config_social_links_parsed_and_trimmed(
    client: AsyncClient, monkeypatch
):
    """Comma-separated links become a clean list; blanks are dropped."""
    monkeypatch.setattr(
        settings, "social_links", " https://a.example/x , ,https://b.example/y,"
    )
    response = await client.get(f"{settings.api_prefix}/config/site")
    assert response.json()["social_links"] == [
        "https://a.example/x",
        "https://b.example/y",
    ]


@pytest.mark.asyncio
async def test_site_config_empty_social_links(client: AsyncClient, monkeypatch):
    """No socials configured -> empty list, not an error."""
    monkeypatch.setattr(settings, "social_links", "")
    response = await client.get(f"{settings.api_prefix}/config/site")
    assert response.status_code == 200
    assert response.json()["social_links"] == []


@pytest.mark.asyncio
async def test_site_config_is_public(client: AsyncClient):
    """No auth required — the frontend fetches this before any login."""
    response = await client.get(
        f"{settings.api_prefix}/config/site", headers={"Authorization": ""}
    )
    assert response.status_code == 200


def test_empty_site_env_falls_back_to_defaults():
    """Compose forwards SITE_NAME=${SITE_NAME:-}: an unset host var arrives as
    an EMPTY string and must NOT blank the branding or the CORS allowlist."""
    from app.config import Settings

    s = Settings(
        SITE_NAME="",
        SITE_URL="  ",
        OWNER_NAME="",
        OWNER_HEADLINE="",
        OWNER_DESCRIPTION="",
        SOCIAL_LINKS="",
        CORS_ORIGINS="",
        _env_file=None,
    )
    defaults = Settings(_env_file=None)
    assert s.site_name == defaults.site_name
    assert s.site_url == defaults.site_url
    assert s.owner_name == defaults.owner_name
    assert s.owner_headline == defaults.owner_headline
    assert s.owner_description == defaults.owner_description
    assert s.social_links == defaults.social_links
    assert s.cors_origins == defaults.cors_origins


def test_empty_analytics_id_stays_empty():
    """analytics_id is the exception: empty is the documented OFF switch."""
    from app.config import Settings

    s = Settings(BEACONFOLIO_ANALYTICS_ID="", _env_file=None)
    assert s.analytics_id == ""


def test_explicit_site_values_win():
    """A real value overrides the default (the normal forker path)."""
    from app.config import Settings

    s = Settings(OWNER_NAME="Jane Doe", SITE_URL="https://jane.example", _env_file=None)
    assert s.owner_name == "Jane Doe"
    assert s.site_url == "https://jane.example"


# --- GTM container id (#447) ---


def test_empty_gtm_container_id_stays_empty():
    """Empty is the documented OFF switch, exactly as for analytics_id — the
    compose files forward ``${BEACONFOLIO_GTM_CONTAINER_ID:-}``, so an unset
    host var arrives as "" and must NOT be coerced into some default."""
    from app.config import Settings

    s = Settings(BEACONFOLIO_GTM_CONTAINER_ID="", _env_file=None)
    assert s.gtm_container_id == ""


def test_gtm_container_id_is_read_from_the_namespaced_alias():
    """The knob binds to BEACONFOLIO_GTM_CONTAINER_ID and to nothing else.

    Pinned because an ambient generic name (``GTM_CONTAINER_ID``) on a shared
    host could otherwise bind a NEIGHBOUR's container and silently ship this
    site's traffic into someone else's property — the #141 namespacing reason,
    which is a data-leak class, not a style preference.
    """
    from app.config import Settings

    s = Settings(BEACONFOLIO_GTM_CONTAINER_ID="GTM-ABC1234", _env_file=None)
    assert s.gtm_container_id == "GTM-ABC1234"

    unnamespaced = Settings(GTM_CONTAINER_ID="GTM-NEIGHBOR", _env_file=None)
    assert unnamespaced.gtm_container_id == ""


def test_gtm_and_analytics_ids_are_independent_knobs():
    """Setting one must not disturb the other. The PRECEDENCE between them is
    a client-side decision (the browser installs one or the other); the server
    reports both faithfully and decides nothing.
    """
    from app.config import Settings

    s = Settings(
        BEACONFOLIO_ANALYTICS_ID="G-AAAAAAA",
        BEACONFOLIO_GTM_CONTAINER_ID="GTM-BBBBBBB",
        _env_file=None,
    )
    assert s.analytics_id == "G-AAAAAAA"
    assert s.gtm_container_id == "GTM-BBBBBBB"
