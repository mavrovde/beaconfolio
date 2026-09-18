"""Runtime site settings: availability (#271) and theme (#339).

Both are admin-editable at runtime and surfaced publicly on /config/site.
"""

import pytest
from httpx import AsyncClient

from app.config import settings

PUBLIC = f"{settings.api_prefix}/config/site"
ADMIN = f"{settings.api_prefix}/admin/site-settings/availability"
ADMIN_THEME = f"{settings.api_prefix}/admin/site-settings/theme"


@pytest.mark.asyncio
async def test_public_config_defaults_to_listening(client: AsyncClient):
    r = await client.get(PUBLIC)
    assert r.status_code == 200
    assert r.json()["availability"] == "listening"


@pytest.mark.asyncio
async def test_admin_sets_availability_and_public_config_reflects_it(
    client: AsyncClient,
):
    assert (await client.put(ADMIN, json={"value": "open"})).json() == {"value": "open"}
    assert (await client.get(PUBLIC)).json()["availability"] == "open"

    # Update path (row exists now), not just insert.
    assert (await client.put(ADMIN, json={"value": "not_looking"})).status_code == 200
    assert (await client.get(PUBLIC)).json()["availability"] == "not_looking"
    assert (await client.get(ADMIN)).json() == {"value": "not_looking"}


@pytest.mark.asyncio
async def test_unknown_state_is_422_and_changes_nothing(client: AsyncClient):
    r = await client.put(ADMIN, json={"value": "yolo"})
    assert r.status_code == 422
    assert "must be one of" in r.json()["detail"]
    assert (await client.get(PUBLIC)).json()["availability"] == "listening"


@pytest.mark.asyncio
async def test_write_requires_admin_auth(normal_client: AsyncClient):
    """The read side is public BY WAY OF /config/site; the write side is not.
    normal_client carries an AUTHENTICATED NON-ADMIN token, so the expected
    answer is exactly 403 (not the 401-or-403 shrug this asserted before —
    #295 review)."""
    r = await normal_client.put(ADMIN, json={"value": "open"})
    assert r.status_code == 403


@pytest.mark.asyncio
async def test_router_gate_rejects_anonymous_reads_and_writes(
    clean_client: AsyncClient,
):
    """The dependency is ROUTER-level: GET must be gated exactly like PUT —
    previously untested (#295 review)."""
    assert (await clean_client.get(ADMIN)).status_code == 401
    assert (await clean_client.put(ADMIN, json={"value": "open"})).status_code == 401


@pytest.mark.asyncio
async def test_public_config_survives_a_db_failure_on_the_availability_read(
    client: AsyncClient, monkeypatch
):
    """/config/site was DB-free before availability; a DB outage must degrade
    the field to the default, never 500 the public site's bootstrap
    (#295 review). The failure is injected at the exact seam — which since #252
    is the shared `read_availability_or_default` wrapper in `site_settings`,
    used by /config/site AND by the machine-readable resume."""
    from app.api import site_settings

    async def boom(db):
        raise RuntimeError("db down")

    monkeypatch.setattr(site_settings, "read_availability", boom)
    r = await client.get(PUBLIC)
    assert r.status_code == 200
    assert r.json()["availability"] == "listening"


@pytest.mark.asyncio
async def test_states_vocabulary_matches_the_frontend_translations(
    client: AsyncClient,
):
    """A new state without translations renders as a raw key on the public
    hero. This test fails BEFORE that ships: every allowed state must have an
    AVAILABILITY.<STATE> entry in both language files."""
    import json
    from pathlib import Path

    from app.api.site_settings import AVAILABILITY_STATES

    i18n = (
        Path(__file__).resolve().parents[2]
        / "frontend"
        / "projects"
        / "shared"
        / "assets"
        / "i18n"
    )
    for lang in ("en", "de"):
        table = json.loads((i18n / f"{lang}.json").read_text())
        for state in AVAILABILITY_STATES:
            key = state.upper()
            assert key in table.get("AVAILABILITY", {}), (
                f"{lang}.json is missing AVAILABILITY.{key}"
            )

    # The admin service duplicates the vocabulary (a frontend file cannot
    # import Python); this pin keeps the copies from drifting (#295 review).
    admin_svc = (
        Path(__file__).resolve().parents[2]
        / "frontend"
        / "projects"
        / "admin"
        / "src"
        / "app"
        / "services"
        / "site-settings.service.ts"
    ).read_text()
    for state in AVAILABILITY_STATES:
        assert f"'{state}'" in admin_svc, (
            f"site-settings.service.ts is missing state '{state}'"
        )


# --------------------------------------------------------------------------
# Theme presets (#339)
# --------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_public_config_defaults_to_the_terminal_theme(client: AsyncClient):
    """The acceptance criterion that protects every EXISTING deployment: with
    nothing chosen, the site is still the terminal look it has always been."""
    r = await client.get(PUBLIC)
    assert r.status_code == 200
    assert r.json()["theme"] == "terminal"


@pytest.mark.asyncio
async def test_admin_sets_theme_and_public_config_reflects_it(client: AsyncClient):
    assert (await client.put(ADMIN_THEME, json={"value": "light"})).json() == {
        "value": "light"
    }
    assert (await client.get(PUBLIC)).json()["theme"] == "light"

    # Update path (the row exists now), not just insert.
    assert (await client.put(ADMIN_THEME, json={"value": "classic"})).status_code == 200
    assert (await client.get(PUBLIC)).json()["theme"] == "classic"
    assert (await client.get(ADMIN_THEME)).json() == {"value": "classic"}


@pytest.mark.asyncio
async def test_every_preset_is_settable(client: AsyncClient):
    """A preset in the vocabulary that the API rejects is a preset the admin
    picker offers and nobody can select."""
    from app.api.site_settings import THEME_PRESETS

    for preset in THEME_PRESETS:
        r = await client.put(ADMIN_THEME, json={"value": preset})
        assert r.status_code == 200, preset
        assert (await client.get(PUBLIC)).json()["theme"] == preset


@pytest.mark.asyncio
async def test_unknown_theme_is_422_and_changes_nothing(client: AsyncClient):
    r = await client.put(ADMIN_THEME, json={"value": "neon-vaporwave"})
    assert r.status_code == 422
    assert "must be one of" in r.json()["detail"]
    assert (await client.get(PUBLIC)).json()["theme"] == "terminal"


@pytest.mark.asyncio
async def test_theme_write_requires_admin_auth(normal_client: AsyncClient):
    assert (
        await normal_client.put(ADMIN_THEME, json={"value": "light"})
    ).status_code == 403


@pytest.mark.asyncio
async def test_theme_router_gate_rejects_anonymous_reads_and_writes(
    clean_client: AsyncClient,
):
    assert (await clean_client.get(ADMIN_THEME)).status_code == 401
    assert (
        await clean_client.put(ADMIN_THEME, json={"value": "light"})
    ).status_code == 401


@pytest.mark.asyncio
async def test_a_stored_value_outside_the_vocabulary_normalizes(client: AsyncClient):
    """The write path validates; the READ path degrades. A row hand-edited in
    the DB — or written by a newer version and read by an older one — must not
    reach the browser, because an unknown name stamps a `data-theme` that no
    stylesheet block matches and the page renders untokenized."""
    from app.api.site_settings import THEME_KEY
    from app.database import get_db
    from app.main import app as fastapi_app
    from app.models.site_setting import SiteSetting

    async for db in fastapi_app.dependency_overrides[get_db]():
        db.add(SiteSetting(key=THEME_KEY, value="from-the-future"))
        await db.commit()
        break

    assert (await client.get(PUBLIC)).json()["theme"] == "terminal"
    assert (await client.get(ADMIN_THEME)).json() == {"value": "terminal"}


@pytest.mark.asyncio
async def test_public_config_survives_a_db_failure_on_the_theme_read(
    client: AsyncClient, monkeypatch
):
    """Same contract as availability: a DB outage costs the site its THEME,
    never its bootstrap."""
    from app.api import site_settings

    async def boom(db):
        raise RuntimeError("db down")

    monkeypatch.setattr(site_settings, "read_theme", boom)
    r = await client.get(PUBLIC)
    assert r.status_code == 200
    assert r.json()["theme"] == "terminal"


def _repo_root():
    from pathlib import Path

    return Path(__file__).resolve().parents[2]


def test_every_theme_preset_has_a_stylesheet_block():
    """The vocabulary and the stylesheet are ONE contract split across two
    languages. A preset the API accepts but `styles.css` has no
    `[data-theme="..."]` block for renders untokenized — the page keeps
    whatever `:root` holds, which is a half-themed render rather than a clean
    fallback. This is the check that fails before that can ship."""
    from app.api.site_settings import THEME_PRESETS

    css = (
        _repo_root() / "frontend" / "projects" / "public" / "src" / "styles.css"
    ).read_text()
    for preset in THEME_PRESETS:
        assert f"[data-theme='{preset}']" in css, (
            f"styles.css has no [data-theme='{preset}'] block"
        )


def test_theme_vocabulary_matches_both_frontend_copies():
    """A TypeScript file cannot import Python, so the vocabulary is duplicated
    in two places — the public app (which normalizes the wire value) and the
    admin app (which renders the picker). This pins all three copies, the same
    way the availability states are pinned."""
    from app.api.site_settings import THEME_DEFAULT, THEME_PRESETS

    root = _repo_root() / "frontend" / "projects"
    public_svc = (
        root / "public" / "src" / "app" / "services" / "site-config.service.ts"
    ).read_text()
    admin_svc = (
        root / "admin" / "src" / "app" / "services" / "site-settings.service.ts"
    ).read_text()

    for preset in THEME_PRESETS:
        assert f"'{preset}'" in public_svc, (
            f"site-config.service.ts is missing '{preset}'"
        )
        assert f"'{preset}'" in admin_svc, (
            f"site-settings.service.ts is missing '{preset}'"
        )

    # The DEFAULT is load-bearing on its own: the public service derives it
    # from the FIRST entry, so a reordering there would silently change what an
    # unconfigured deployment renders.
    assert THEME_DEFAULT == THEME_PRESETS[0]
    assert f"THEME_PRESETS = ['{THEME_DEFAULT}'," in public_svc
