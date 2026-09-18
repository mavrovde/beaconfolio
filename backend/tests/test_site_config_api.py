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
        "theme",
        # Brand assets (#67) — five overrides that let a forker rebrand a
        # PREBUILT frontend image without editing `index.html` or a template.
        "brand_favicon_url",
        "brand_logo_url",
        "brand_og_image_url",
        "brand_font_css_url",
        "brand_font_family",
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


# --- Brand assets (#67) ---

BRAND_KNOBS = (
    "brand_favicon_url",
    "brand_logo_url",
    "brand_og_image_url",
    "brand_font_css_url",
    "brand_font_family",
)


@pytest.mark.asyncio
async def test_site_config_reflects_brand_settings(client: AsyncClient, monkeypatch):
    """The five brand fields are derived from Settings, not hardcoded.

    Each knob gets a DISTINCT value, so a payload that copied one field into
    another — or that returned a constant — fails here. Asserting equality
    against unmodified settings would pass against a hardcoded copy of the
    defaults, which are all "" (the #255 review's mutation finding).
    """
    expected = {knob: f"https://cdn.example/{knob}" for knob in BRAND_KNOBS}
    for knob, value in expected.items():
        monkeypatch.setattr(settings, knob, value)

    response = await client.get(f"{settings.api_prefix}/config/site")
    data = response.json()
    for knob, value in expected.items():
        assert data[knob] == value, f"{knob} not served from Settings"


@pytest.mark.asyncio
async def test_site_config_brand_assets_default_to_empty(
    client: AsyncClient, monkeypatch
):
    """Empty is not "unconfigured", it is the DOCUMENTED value that means
    "use the bundled asset" — the shipped favicon, the shipped social card,
    the wordmark derived from owner_name, the stylesheet index.html links.

    So the endpoint must serve "" rather than omitting the key or substituting
    a guess: the client distinguishes nothing else, and a server-side default
    would take the override away from a forker who wants the bundled asset.
    """
    for knob in BRAND_KNOBS:
        monkeypatch.setattr(settings, knob, "")

    data = (await client.get(f"{settings.api_prefix}/config/site")).json()
    for knob in BRAND_KNOBS:
        assert data[knob] == "", f"{knob} should stay empty"


def test_empty_brand_env_stays_empty():
    """Compose forwards ``${BEACONFOLIO_BRAND_*:-}``, so an unset host var
    arrives as an EMPTY STRING. These five are the ``analytics_id`` case, not
    the ``site_name`` case: "" already IS the default, so they are deliberately
    absent from the empty-means-default validator and must NOT be coerced.
    """
    from app.config import Settings

    s = Settings(
        BEACONFOLIO_BRAND_FAVICON_URL="",
        BEACONFOLIO_BRAND_LOGO_URL="",
        BEACONFOLIO_BRAND_OG_IMAGE_URL="",
        BEACONFOLIO_BRAND_FONT_CSS_URL="",
        BEACONFOLIO_BRAND_FONT_FAMILY="",
        _env_file=None,
    )
    for knob in BRAND_KNOBS:
        assert getattr(s, knob) == ""


def test_brand_knobs_are_read_from_the_namespaced_aliases():
    """Each knob binds to its BEACONFOLIO_-prefixed alias and to nothing else.

    This is the #141 namespacing reason in its sharpest form: ``FAVICON_URL``,
    ``LOGO_URL`` and ``FONT_FAMILY`` are exactly the generic names another
    tenant on a shared host may already export, and inheriting a NEIGHBOUR's
    brand is a visible mis-identification of the site — the same class as the
    GTM container leak, pointed at identity instead of analytics.
    """
    from app.config import Settings

    namespaced = Settings(
        BEACONFOLIO_BRAND_FAVICON_URL="https://cdn.example/fav.svg",
        BEACONFOLIO_BRAND_LOGO_URL="https://cdn.example/logo.svg",
        BEACONFOLIO_BRAND_OG_IMAGE_URL="https://cdn.example/card.png",
        BEACONFOLIO_BRAND_FONT_CSS_URL="https://fonts.example/inter.css",
        BEACONFOLIO_BRAND_FONT_FAMILY="'Inter', sans-serif",
        _env_file=None,
    )
    assert namespaced.brand_favicon_url == "https://cdn.example/fav.svg"
    assert namespaced.brand_logo_url == "https://cdn.example/logo.svg"
    assert namespaced.brand_og_image_url == "https://cdn.example/card.png"
    assert namespaced.brand_font_css_url == "https://fonts.example/inter.css"
    assert namespaced.brand_font_family == "'Inter', sans-serif"

    ambient = Settings(
        BRAND_FAVICON_URL="https://neighbour.example/fav.svg",
        FAVICON_URL="https://neighbour.example/fav.svg",
        LOGO_URL="https://neighbour.example/logo.svg",
        OG_IMAGE_URL="https://neighbour.example/card.png",
        FONT_CSS_URL="https://neighbour.example/font.css",
        FONT_FAMILY="'Neighbour', sans-serif",
        _env_file=None,
    )
    for knob in BRAND_KNOBS:
        assert getattr(ambient, knob) == "", f"{knob} bound an un-namespaced name"


def test_brand_knobs_do_not_disturb_the_rest_of_the_identity():
    """Five new Settings fields must not perturb the #65 identity block — the
    validator that turns an empty SITE_NAME back into its default runs over a
    field list, and a field added to the wrong list would blank a name.
    """
    from app.config import Settings

    defaults = Settings(_env_file=None)
    s = Settings(
        BEACONFOLIO_BRAND_FAVICON_URL="https://cdn.example/fav.svg",
        BEACONFOLIO_BRAND_FONT_FAMILY="'Inter', sans-serif",
        _env_file=None,
    )
    assert s.site_name == defaults.site_name
    assert s.owner_name == defaults.owner_name
    assert s.site_url == defaults.site_url
    assert s.analytics_id == defaults.analytics_id
    assert s.gtm_container_id == defaults.gtm_container_id
