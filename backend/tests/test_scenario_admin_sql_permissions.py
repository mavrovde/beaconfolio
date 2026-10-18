import pytest
from httpx import AsyncClient

from app.config import settings


@pytest.mark.asyncio
async def test_admin_sql_execute_forbidden(
    normal_client: AsyncClient, normal_user_token_headers
):
    """Test SQL execution with non-admin user returns 403."""
    response = await normal_client.post(
        f"{settings.api_prefix}/admin/sql/execute",
        headers=normal_user_token_headers,
        json={"query": "SELECT * FROM users"},
    )
    assert response.status_code == 403
    assert response.json()["detail"] == "Not enough permissions"


@pytest.mark.asyncio
async def test_admin_sql_backup_forbidden(
    normal_client: AsyncClient, normal_user_token_headers
):
    """Test backup with non-admin user returns 403."""
    response = await normal_client.get(
        f"{settings.api_prefix}/admin/sql/backup", headers=normal_user_token_headers
    )
    assert response.status_code == 403
    assert response.json()["detail"] == "Not enough permissions"


@pytest.mark.asyncio
async def test_admin_sql_restore_forbidden(
    normal_client: AsyncClient, normal_user_token_headers
):
    """Test restore with non-admin user returns 403."""
    # We need to simulate file upload even if it's forbidden, to hit the endpoint logic
    response = await normal_client.post(
        f"{settings.api_prefix}/admin/sql/restore",
        headers=normal_user_token_headers,
        files={"file": ("backup.sql", b"content", "application/sql")},
    )
    assert response.status_code == 403
    assert response.json()["detail"] == "Not enough permissions"


@pytest.mark.asyncio
async def test_admin_sql_execute_refuses_a_write_statement(
    client: AsyncClient, admin_token_headers
):
    """The console is read-only: a DML statement is refused before it reaches the DB."""
    query = "UPDATE users SET is_active = true WHERE email = 'admin@example.com'"

    response = await client.post(
        f"{settings.api_prefix}/admin/sql/execute",
        headers=admin_token_headers,
        json={"query": query},
    )
    assert response.status_code == 400
    assert "read-only" in response.json()["detail"]
