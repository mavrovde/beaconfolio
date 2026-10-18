from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.api import admin_sql

# ---------------------------------------------------------------------------
# execute_sql: row / no-row / no-return branches (lines 34, 36-46)
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_unreleasable_lock_discards_the_connection_and_keeps_the_real_error(
    client: AsyncClient, db_session: AsyncSession
):
    """DB unreachable: the advisory-unlock cleanup fails too. The connection is
    invalidated (never pooled while possibly holding a lock) and the caller gets
    the STATEMENT's error, not the cleanup's."""
    with (
        patch.object(
            db_session, "execute", AsyncMock(side_effect=Exception("DB down"))
        ),
        patch.object(db_session, "rollback", AsyncMock()),
        patch.object(db_session, "invalidate", AsyncMock()) as invalidate_mock,
    ):
        response = await client.post(
            "/api/app/admin/sql/execute", json={"query": "SELECT 1"}
        )

    assert response.status_code == 501
    assert response.json()["detail"] == "SQL Execution Error: DB down"
    invalidate_mock.assert_awaited_once()


@pytest.mark.asyncio
async def test_execute_sql_without_rows_never_commits(
    client: AsyncClient, db_session: AsyncSession
):
    """An empty result yields [] and the console NEVER commits — it rolls back.

    Before the read-only console a row-less statement committed; the spy on the
    session asserts the seam (what the session is asked to do), not the payload.
    """
    mock_result = MagicMock()
    mock_result.fetchall.return_value = []

    with (
        patch.object(db_session, "execute", AsyncMock(return_value=mock_result)),
        patch.object(db_session, "commit", AsyncMock()) as commit_mock,
        patch.object(db_session, "rollback", AsyncMock()) as rollback_mock,
    ):
        response = await client.post(
            "/api/app/admin/sql/execute",
            json={"query": "SHOW server_version"},
        )

    assert response.status_code == 200
    assert response.json() == []
    commit_mock.assert_not_awaited()
    # Rolled back after the statement, and again after releasing advisory locks.
    assert rollback_mock.await_count == 2


@pytest.mark.asyncio
async def test_execute_sql_returns_rows(client: AsyncClient, db_session: AsyncSession):
    """A SELECT with rows should map keys->values into dicts."""
    mock_result = MagicMock()
    mock_result.returns_rows = True
    mock_result.fetchall.return_value = [(42, "hi")]
    mock_result.keys.return_value = ["answer", "greeting"]

    with patch.object(db_session, "execute", AsyncMock(return_value=mock_result)):
        response = await client.post(
            "/api/app/admin/sql/execute",
            json={"query": "SELECT 42 AS answer, 'hi' AS greeting"},
        )

    assert response.status_code == 200
    assert response.json() == [{"answer": 42, "greeting": "hi"}]


@pytest.mark.asyncio
async def test_execute_sql_returns_empty_rows(
    client: AsyncClient, db_session: AsyncSession
):
    """A rows-capable result with zero rows should yield []."""
    mock_result = MagicMock()
    mock_result.returns_rows = True
    mock_result.fetchall.return_value = []

    with patch.object(db_session, "execute", AsyncMock(return_value=mock_result)):
        response = await client.post(
            "/api/app/admin/sql/execute",
            json={"query": "SELECT 1 AS x WHERE 1 = 0"},
        )

    assert response.status_code == 200
    assert response.json() == []


# ---------------------------------------------------------------------------
# _get_db_url: both branches of the +asyncpg strip (lines 61-63)
# ---------------------------------------------------------------------------


def test_get_db_url_strips_asyncpg():
    fake_settings = MagicMock()
    fake_settings.database_url = "postgresql+asyncpg://u:p@host:5432/db"
    with patch("app.api.admin_sql.settings", fake_settings):
        assert admin_sql._get_db_url() == "postgresql://u:p@host:5432/db"


def test_get_db_url_without_asyncpg_untouched():
    fake_settings = MagicMock()
    fake_settings.database_url = "postgresql://u:p@host:5432/db"
    with patch("app.api.admin_sql.settings", fake_settings):
        assert admin_sql._get_db_url() == "postgresql://u:p@host:5432/db"


# ---------------------------------------------------------------------------
# restore_database: timeout branch (lines 149-151)
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_restore_timeout(client: AsyncClient):
    mock_proc = AsyncMock()
    mock_proc.returncode = 0
    mock_proc.kill = MagicMock()

    async def raise_timeout(*args, **kwargs):
        raise TimeoutError()

    files = {"file": ("backup.sql", b"SELECT 1;", "application/sql")}
    with (
        patch("asyncio.create_subprocess_exec", return_value=mock_proc),
        patch("asyncio.wait_for", side_effect=raise_timeout),
    ):
        response = await client.post("/api/app/admin/sql/restore", files=files)

    assert response.status_code == 500
    assert "Restore timed out" in response.json()["detail"]
    mock_proc.kill.assert_called_once()


# ---------------------------------------------------------------------------
# restore_database: stdout & stderr truncation branches (lines 166, 173)
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_restore_truncates_long_stdout_and_stderr(client: AsyncClient):
    long_stdout = ("A" * 2500).encode()
    long_stderr = ("B" * 2500).encode()

    mock_proc = AsyncMock()
    mock_proc.returncode = 0
    mock_proc.communicate = AsyncMock(return_value=(long_stdout, long_stderr))

    files = {"file": ("backup.sql", b"SELECT 1;", "application/sql")}
    with patch("asyncio.create_subprocess_exec", return_value=mock_proc):
        response = await client.post("/api/app/admin/sql/restore", files=files)

    assert response.status_code == 200
    output = response.json()["output"]
    assert "chars total, truncated" in output
    # Both stdout and stderr sections should have been truncated.
    assert output.count("truncated") == 2
