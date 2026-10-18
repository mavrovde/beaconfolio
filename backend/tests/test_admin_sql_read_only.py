"""The admin SQL console is READ-ONLY, enforced by PostgreSQL itself.

Snyk Code `python/Sqli` / CodeQL `py/sql-injection` flag `admin_sql.py`
because request-body SQL reaches `sqlalchemy.text`. Running admin-authored SQL
is the console's purpose, so the fix bounds what that SQL can DO, in three
layers (module comment in `app/api/admin_sql.py`). Each layer below is pinned
against the real test database, not a mock, because the guarantee lives in the
server: a mocked session would pass with the READ ONLY transaction deleted.
"""

import pytest
from fastapi import HTTPException
from httpx import AsyncClient
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.api import admin_sql
from app.api.admin_sql import _read_only_statement
from app.database import get_db
from app.main import app
from app.models.user import User

URL = "/api/app/admin/sql/execute"


async def _seed_user(db: AsyncSession) -> None:
    db.add(
        User(
            username="sqlro",
            email="sqlro@example.com",
            hashed_password="x",
            is_admin=False,
            is_active=True,
        )
    )
    await db.commit()


async def _user_count(db: AsyncSession) -> int:
    return int((await db.execute(text("SELECT count(*) FROM users"))).scalar_one())


@pytest.mark.parametrize(
    "query",
    [
        "UPDATE users SET is_active = false",
        "  delete from users",
        "DROP TABLE users",
        "COPY users TO '/tmp/users.csv'",
        "SET TRANSACTION READ WRITE",
        "DO $$ BEGIN DELETE FROM users; END $$",
        "-- comment first\nDELETE FROM users",
        "",
    ],
)
def test_keyword_allowlist_refuses_non_read_statements(query):
    """Layer 1: only statements opening with a read keyword pass."""
    with pytest.raises(HTTPException) as exc:
        _read_only_statement(query)
    assert exc.value.status_code == 400


@pytest.mark.parametrize(
    "query",
    [
        "SELECT 1",
        "  with x as (select 1) select * from x",
        "EXPLAIN SELECT 1",
        "SHOW server_version",
        "VALUES (1)",
        "TABLE users",
    ],
)
def test_keyword_allowlist_accepts_read_statements(query):
    assert _read_only_statement(query) == query


@pytest.mark.asyncio
async def test_data_modifying_cte_is_refused_by_the_server(
    client: AsyncClient, db_session: AsyncSession
):
    """Layer 2: a write hidden behind SELECT/WITH is refused by PostgreSQL."""
    await _seed_user(db_session)
    before = await _user_count(db_session)
    assert before >= 1

    response = await client.post(
        URL,
        json={
            "query": "WITH d AS (DELETE FROM users RETURNING id) SELECT count(*) FROM d"
        },
    )

    assert response.status_code == 501
    assert "read-only transaction" in response.json()["detail"]
    assert await _user_count(db_session) == before


@pytest.mark.asyncio
async def test_explain_analyze_of_a_write_is_refused_by_the_server(
    client: AsyncClient, db_session: AsyncSession
):
    """EXPLAIN ANALYZE executes its statement; READ ONLY still refuses the write."""
    await _seed_user(db_session)
    before = await _user_count(db_session)

    response = await client.post(
        URL, json={"query": "EXPLAIN ANALYZE DELETE FROM users"}
    )

    assert response.status_code == 501
    assert "read-only transaction" in response.json()["detail"]
    assert await _user_count(db_session) == before


@pytest.mark.asyncio
async def test_chained_statements_are_refused(
    client: AsyncClient, db_session: AsyncSession
):
    """`SELECT 1; DROP TABLE users` cannot ride along behind a read keyword."""
    await _seed_user(db_session)
    before = await _user_count(db_session)

    response = await client.post(URL, json={"query": "SELECT 1; DROP TABLE users"})

    assert response.status_code == 501
    assert await _user_count(db_session) == before


@pytest.mark.asyncio
async def test_switching_back_to_read_write_is_refused(client: AsyncClient):
    """A function-level attempt to lift READ ONLY mid-transaction fails."""
    response = await client.post(
        URL, json={"query": "SELECT set_config('transaction_read_only', 'off', true)"}
    )
    assert response.status_code == 501


@pytest.mark.asyncio
async def test_session_settings_do_not_leak_past_the_request(
    client: AsyncClient, db_session: AsyncSession
):
    """Layer 3: the unconditional rollback undoes even a session-level SET."""
    first = await client.post(
        URL,
        json={"query": "SELECT set_config('application_name', 'leaked', false) AS v"},
    )
    assert first.status_code == 200
    assert first.json() == [{"v": "leaked"}]

    shown = (await db_session.execute(text("SHOW application_name"))).scalar_one()
    assert shown != "leaked"


@pytest.mark.asyncio
async def test_read_returns_rows_and_leaves_no_open_transaction(
    client: AsyncClient, db_session: AsyncSession
):
    await _seed_user(db_session)
    response = await client.post(
        URL, json={"query": "SELECT username FROM users WHERE username = 'sqlro'"}
    )
    assert response.status_code == 200
    assert response.json() == [{"username": "sqlro"}]
    assert not db_session.in_transaction()


@pytest.mark.asyncio
async def test_statement_timeout_cancels_a_runaway_read(
    client: AsyncClient, db_session: AsyncSession, monkeypatch
):
    """Layer 4: a statement running past STATEMENT_TIMEOUT_MS is cancelled by the server."""
    monkeypatch.setattr(admin_sql, "STATEMENT_TIMEOUT_MS", 50)
    response = await client.post(URL, json={"query": "SELECT pg_sleep(1)"})
    assert response.status_code == 501
    assert "statement timeout" in response.json()["detail"]
    assert not db_session.in_transaction()


ADVISORY_KEY = 4954951


async def _advisory_locks_held(db: AsyncSession) -> int:
    held = await db.execute(
        text(
            "SELECT count(*) FROM pg_locks WHERE locktype = 'advisory' "
            "AND objid = :key AND granted"
        ),
        {"key": ADVISORY_KEY},
    )
    count = int(held.scalar_one())
    await db.rollback()
    return count


@pytest.mark.asyncio
async def test_session_advisory_lock_is_not_held_after_the_request(
    client: AsyncClient, db_session: AsyncSession
):
    """A session advisory lock survives ROLLBACK, so the console releases it.

    The suite's engine is NullPool (a released connection is CLOSED, which drops
    every lock and would let this pass with the release deleted), so the console
    runs here on a POOLED engine like production's: the connection goes back to
    the pool alive, and only `pg_advisory_unlock_all()` frees the lock.
    """
    url = db_session.bind.url.render_as_string(hide_password=False)
    pooled = create_async_engine(url, pool_size=1, max_overflow=0)
    pooled_session = async_sessionmaker(pooled, expire_on_commit=False)

    async def pooled_db():
        async with pooled_session() as session:
            yield session

    previous = app.dependency_overrides[get_db]
    app.dependency_overrides[get_db] = pooled_db
    try:
        response = await client.post(
            URL, json={"query": f"SELECT pg_advisory_lock({ADVISORY_KEY}) AS locked"}
        )
        assert response.status_code == 200
        # Checked from a DIFFERENT connection while the pooled one is still open.
        assert await _advisory_locks_held(db_session) == 0
    finally:
        app.dependency_overrides[get_db] = previous
        await pooled.dispose()
