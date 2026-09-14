import pytest
from httpx import AsyncClient
from sqlalchemy import text
from sqlalchemy.exc import OperationalError

from app.config import settings


@pytest.mark.asyncio
async def test_root_endpoint(client: AsyncClient):
    """Test root endpoint."""
    response = await client.get("/")
    assert response.status_code == 200
    data = response.json()
    assert "message" in data
    assert f"{settings.site_name} API" in data["message"]


@pytest.mark.asyncio
async def test_health_check(client: AsyncClient):
    """Health reports ready (200) once the schema is present."""
    response = await client.get(f"{settings.api_prefix}/health")
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "healthy"
    assert data["ready"] is True


@pytest.mark.asyncio
async def test_health_not_ready_when_schema_missing(client: AsyncClient, db_session):
    """During the startup race (#124) health reports a retryable 503, not 200."""
    await db_session.execute(text("DROP TABLE profile_snapshots"))
    await db_session.commit()

    response = await client.get(f"{settings.api_prefix}/health")
    assert response.status_code == 503
    data = response.json()
    assert data["status"] == "initializing"
    assert data["ready"] is False


@pytest.mark.asyncio
async def test_health_not_ready_when_db_unreachable(client: AsyncClient, monkeypatch):
    """A DB error during the probe surfaces as not-ready (503), never a raw 500."""

    async def _boom(_session):
        raise OperationalError("SELECT 1", {}, Exception("db down"))

    monkeypatch.setattr("app.main.schema_ready", _boom)

    response = await client.get(f"{settings.api_prefix}/health")
    assert response.status_code == 503
    assert response.json()["ready"] is False


@pytest.mark.asyncio
async def test_ping(client: AsyncClient) -> None:
    """Test ping endpoint."""
    response = await client.get(f"{settings.api_prefix}/ping")
    assert response.status_code == 200
    assert response.json() == {"ping": "ok"}


def test_retired_prefix_warning_names_the_keys(monkeypatch, capsys):
    """#330 hard break: a leftover retired-prefix key must be NAMED at startup,
    not silently ignored — the failure mode is 'my token stopped working'."""
    from app.main import RETIRED_ENV_PREFIX, _warn_retired_env

    monkeypatch.setenv(f"{RETIRED_ENV_PREFIX}GEMINI_API_KEY", "x")
    monkeypatch.setenv(f"{RETIRED_ENV_PREFIX}TELEGRAM_CHAT_ID", "y")
    _warn_retired_env()
    out = capsys.readouterr().out
    assert "IGNORED since the #330 rebrand" in out
    assert f"{RETIRED_ENV_PREFIX}GEMINI_API_KEY" in out
    assert f"{RETIRED_ENV_PREFIX}TELEGRAM_CHAT_ID" in out


def test_retired_prefix_warning_silent_when_clean(monkeypatch, capsys):
    import os

    from app.main import RETIRED_ENV_PREFIX, _warn_retired_env

    for k in list(os.environ):
        if k.startswith(RETIRED_ENV_PREFIX):
            monkeypatch.delenv(k)
    _warn_retired_env()
    assert "IGNORED" not in capsys.readouterr().out


def test_identity_report_loud_when_defaults_live(monkeypatch, capsys):
    """#335: the demo persona on a real deployment must be LOUD, not silent —
    the 2026-09-10 first deploy shipped 'Home | Jane Doe' on the prod domain."""
    from app.config import settings
    from app.main import _report_identity

    cls = type(settings)
    monkeypatch.setattr(settings, "site_url", cls.model_fields["site_url"].default)
    monkeypatch.setattr(settings, "owner_name", cls.model_fields["owner_name"].default)
    monkeypatch.delenv("PUBLIC_URL", raising=False)
    _report_identity()
    out = capsys.readouterr().out
    assert "IDENTITY: site_url=" in out
    assert "DEFAULTS IN USE" in out
    assert "SITE_URL" in out and "OWNER_NAME" in out


def test_identity_report_quiet_when_identity_set(monkeypatch, capsys):
    from app.config import settings
    from app.main import _report_identity

    monkeypatch.setattr(settings, "site_url", "https://portfolio.example.net")
    monkeypatch.setattr(settings, "owner_name", "Alex Realname")
    monkeypatch.delenv("PUBLIC_URL", raising=False)
    _report_identity()
    out = capsys.readouterr().out
    assert "IDENTITY: site_url=https://portfolio.example.net" in out
    assert "DEFAULTS IN USE" not in out
    assert "CONFIG WARNING" not in out


def test_identity_cross_warning_public_url_without_site_url(monkeypatch, capsys):
    """#335: PUBLIC_URL set while SITE_URL is defaulted must name BOTH knobs
    and their jobs — the near-synonym is the measured trap."""
    from app.config import settings
    from app.main import _report_identity

    cls = type(settings)
    monkeypatch.setattr(settings, "site_url", cls.model_fields["site_url"].default)
    monkeypatch.setenv("PUBLIC_URL", "https://beaconfolio.example")
    _report_identity()
    out = capsys.readouterr().out
    assert "CONFIG WARNING: PUBLIC_URL is set but SITE_URL is not" in out
    assert "probe" in out and "SEO" in out


def test_identity_no_cross_warning_when_site_url_set(monkeypatch, capsys):
    from app.config import settings
    from app.main import _report_identity

    monkeypatch.setattr(settings, "site_url", "https://portfolio.example.net")
    monkeypatch.setenv("PUBLIC_URL", "https://beaconfolio.example")
    _report_identity()
    assert "CONFIG WARNING" not in capsys.readouterr().out


def test_retired_prefix_warning_reads_the_forwarded_channel(monkeypatch, capsys):
    """In a container the retired keys never reach the process env; compose
    forwards their NAMES via LEGACY_GEMINI_ENV — the diagnostic must read it."""
    from app.main import RETIRED_ENV_PREFIX, _warn_retired_env

    monkeypatch.setenv(
        "LEGACY_GEMINI_ENV", f"GEMINI_API_KEY {RETIRED_ENV_PREFIX}TELEGRAM_BOT_TOKEN"
    )
    _warn_retired_env()
    out = capsys.readouterr().out
    assert f"{RETIRED_ENV_PREFIX}TELEGRAM_BOT_TOKEN" in out
    assert "GEMINI_API_KEY," not in out  # pre-#141 names belong to the other warning


def test_identity_empty_env_maps_to_defaults_seam():
    """#335 review round 1: the identity tests above monkeypatch `settings`
    directly, so nothing HERE pinned the seam the feature rides in a container
    — compose always sets `SITE_URL=${SITE_URL:-}`, i.e. an EMPTY string, and
    `_empty_site_field_means_default` maps that back to the class default.
    Construct Settings the way the container does and assert the mapping, so
    a change to that validator reddens the identity feature's own test file."""
    from app.config import Settings

    s = Settings(SITE_URL="", OWNER_NAME="", _env_file=None)
    cls = type(s)
    assert s.site_url == cls.model_fields["site_url"].default
    assert s.owner_name == cls.model_fields["owner_name"].default
