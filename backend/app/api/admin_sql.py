import re
from typing import Any

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.database import get_db
from app.logger import get_logger
from app.models.user import User
from app.services.auth import get_current_admin_user

logger = get_logger(__name__)

router = APIRouter(
    prefix="/admin/sql", tags=["admin"], dependencies=[Depends(get_current_admin_user)]
)


# The console is a READ-ONLY query tool. Admin-authored SQL from the request
# body is the feature, so the bound is not "which SQL" but "what the SQL can
# do". The layers work TOGETHER — none of them alone is the guarantee:
#   1. the statement must open with a read keyword: no COPY (it reaches the
#      server filesystem and, as a superuser, `TO PROGRAM`), DO, CALL, SET,
#      GRANT, VACUUM or any DDL/DML verb. This alone does NOT keep the data
#      unchanged — `WITH x AS (DELETE ... RETURNING *) SELECT ...` passes it;
#   2. it runs inside `SET TRANSACTION READ ONLY`, so PostgreSQL itself refuses
#      every write the keyword check cannot see (that CTE, `EXPLAIN ANALYZE
#      UPDATE ...`, `nextval()`), and refuses a switch back to read-write once
#      the statement's snapshot is taken;
#   3. the transaction is ALWAYS rolled back, so a session-level setting
#      smuggled through a function (`set_config(..., false)`) cannot leak onto
#      the pooled connection; session advisory locks are not transactional, so
#      they are released explicitly (`pg_advisory_unlock_all()`) as well;
#   4. `statement_timeout` bounds how long one statement may hold a connection.
# asyncpg runs the statement as ONE prepared statement, so a chained
# `SELECT 1; DROP TABLE users` is refused by the driver before layer 2.
# Data changes go through the app's own endpoints or the restore path.
#
# KNOWN RESIDUAL: the app connects as a database SUPERUSER, so superuser-only
# functions that are legal in a read-only transaction (`pg_read_file`,
# `pg_ls_dir`, `pg_reload_conf`, `pg_terminate_backend`, ...) stay callable
# from this admin-only console. READ ONLY bounds data changes, not superuser
# powers; the real fix is a dedicated non-superuser role for the console on the
# production database, which is outside this change.
READ_ONLY_KEYWORDS = frozenset({"select", "with", "explain", "show", "values", "table"})
_LEADING_KEYWORD = re.compile(r"\s*([A-Za-z]+)")
# A runaway read (an accidental cross join) must not pin a pool connection.
STATEMENT_TIMEOUT_MS = 30_000


class SqlQuery(BaseModel):
    query: str


def _read_only_statement(query: str) -> str:
    """Return ``query`` if it opens with a read keyword, else raise 400."""
    match = _LEADING_KEYWORD.match(query)
    keyword = match.group(1).lower() if match else ""
    if keyword not in READ_ONLY_KEYWORDS:
        allowed = ", ".join(sorted(k.upper() for k in READ_ONLY_KEYWORDS))
        raise HTTPException(
            status_code=400,
            detail=f"The SQL console is read-only: a statement must start with {allowed}.",
        )
    return query


@router.post("/execute", response_model=list[dict[str, Any]])
async def execute_sql(
    sql: SqlQuery,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_admin_user),
):
    statement = _read_only_statement(sql.query)
    try:
        await db.execute(text("SET TRANSACTION READ ONLY"))
        await db.execute(text(f"SET LOCAL statement_timeout = {STATEMENT_TIMEOUT_MS}"))
        # Executing admin-authored SQL is this endpoint's purpose (admin-only
        # router, see `dependencies=` above). It is bounded by the layers in
        # the module comment, which together keep the data unchanged.
        # deepcode ignore Sqli: admin-only console, read-only at the DB level (READ ONLY transaction, keyword allowlist, unconditional rollback)
        result = await db.execute(text(statement))
        # Every allowlisted statement returns rows (SHOW and EXPLAIN included).
        rows = result.fetchall()
        keys = list(result.keys())
        return [dict(zip(keys, row)) for row in rows]
    except Exception as e:
        logger.exception("SQL execution error")
        # First line only, capped: enough for the operator, no stack trace.
        error_msg = str(e).split("\n")[0][:200]
        raise HTTPException(status_code=501, detail=f"SQL Execution Error: {error_msg}")
    finally:
        await db.rollback()
        # Session-level advisory locks survive a rollback and would stay held
        # by the pooled connection; release any the statement took. If that
        # cannot be done (the database is unreachable), the connection is
        # INVALIDATED instead — discarded, never returned to the pool still
        # holding a lock — and the statement's own error is what the caller
        # sees, not the cleanup's.
        try:
            await db.execute(text("SELECT pg_advisory_unlock_all()"))
            await db.rollback()
        except Exception:
            logger.exception(
                "Could not release advisory locks; discarding the connection"
            )
            await db.invalidate()


def _get_db_url():
    """Get the database URL with +asyncpg stripped for CLI tools."""
    db_url = str(settings.database_url)
    if "+asyncpg" in db_url:
        db_url = db_url.replace("+asyncpg", "")
    return db_url


@router.get("/backup")
async def backup_database(current_user: User = Depends(get_current_admin_user)):
    import asyncio
    import os
    from datetime import UTC, datetime

    from fastapi.responses import StreamingResponse

    db_url = _get_db_url()

    # Generate backup filename
    timestamp = datetime.now(UTC).strftime("%Y%m%d_%H%M%S")
    filename = f"backup_beaconfolio_{timestamp}.sql"

    cmd = ["pg_dump", db_url]

    try:
        proc = await asyncio.create_subprocess_exec(
            *cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            env={**os.environ},
        )
    except FileNotFoundError:
        raise HTTPException(
            status_code=500, detail="pg_dump not found. Is postgresql-client installed?"
        )

    async def iter_backup():
        try:
            while True:
                chunk = await proc.stdout.read(8192)
                if not chunk:
                    break
                yield chunk

            await proc.wait()
            if proc.returncode != 0:
                stderr = await proc.stderr.read()
                print(f"Backup failed (exit {proc.returncode}): {stderr.decode()}")
        except Exception as e:
            print(f"Backup streaming error: {e}")
        finally:
            if proc.returncode is None:
                proc.terminate()

    return StreamingResponse(
        iter_backup(),
        media_type="application/sql",
        headers={"Content-Disposition": f"attachment; filename={filename}"},
    )


@router.post("/restore")
async def restore_database(
    file: UploadFile = File(...), current_user: User = Depends(get_current_admin_user)
):
    import asyncio
    import os

    if not file.filename or not file.filename.endswith(".sql"):
        raise HTTPException(status_code=400, detail="Only .sql files are allowed")

    db_url = _get_db_url()
    cmd = ["psql", db_url]

    try:
        proc = await asyncio.create_subprocess_exec(
            *cmd,
            stdin=asyncio.subprocess.PIPE,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            env={**os.environ},
        )

        # Read uploaded file content
        content = await file.read()
        file_size = len(content)

        # Communicate with a bounded timeout so a hung psql cannot pin the
        # worker forever; a large dump legitimately needs a bigger ceiling, so
        # the bound is configurable (#207).
        try:
            stdout, stderr = await asyncio.wait_for(
                proc.communicate(input=content),
                timeout=settings.db_restore_timeout_seconds,
            )
        except TimeoutError:
            proc.kill()
            raise HTTPException(
                status_code=500,
                detail=(
                    f"Restore timed out after "
                    f"{settings.db_restore_timeout_seconds}s. "
                    f"File size: {file_size} bytes"
                ),
            )

        stdout_text = stdout.decode() if stdout else ""
        stderr_text = stderr.decode() if stderr else ""

        # Build detailed log
        log_lines = []
        log_lines.append(f"File: {file.filename} ({file_size:,} bytes)")
        log_lines.append(f"Exit code: {proc.returncode}")
        if stdout_text:
            # Truncate very long output
            if len(stdout_text) > 2000:
                stdout_text = (
                    stdout_text[:2000]
                    + f"\n... ({len(stdout_text)} chars total, truncated)"
                )
            log_lines.append(f"stdout:\n{stdout_text}")
        if stderr_text:
            if len(stderr_text) > 2000:
                stderr_text = (
                    stderr_text[:2000]
                    + f"\n... ({len(stderr_text)} chars total, truncated)"
                )
            log_lines.append(f"stderr:\n{stderr_text}")

        log_output = "\n".join(log_lines)

        if proc.returncode != 0:
            raise HTTPException(
                status_code=500,
                detail=f"Restore failed (exit {proc.returncode}):\n{log_output}",
            )

        return {"message": "Database restored successfully", "output": log_output}

    except FileNotFoundError:
        raise HTTPException(
            status_code=500, detail="psql not found. Is postgresql-client installed?"
        )
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Restore error: {e!s}")
