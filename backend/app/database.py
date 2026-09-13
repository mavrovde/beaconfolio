from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase

from app.config import settings

# REQUEST pool (#326). The numbers are DELIBERATE, not inherited:
#
# * `db_pool_size` (20) is the steady-state budget: one in-flight request holds
#   exactly ONE connection from here — `get_db` yields a single session — which
#   covers the concurrency this single-owner portfolio actually sees.
# * `db_max_overflow` (40) is the burst budget on top, a hard ceiling of 60
#   simultaneous connections. Postgres' default `max_connections` is 100, and
#   the stack runs ONE backend replica plus the odd admin psql, so 60 stays
#   comfortably inside it while absorbing a spike.
# * A request that finds all 60 in use WAITS (SQLAlchemy's default 30 s
#   `pool_timeout`) rather than failing. That is only survivable while the
#   one-connection-per-request rule holds — a request that needs a SECOND
#   connection while holding its first can deadlock the pool against itself.
#   #326 was exactly that: every analytics emit opened its own connection from
#   this pool, and the emit runs while the request's session is still open, so
#   300 requests at concurrency 60 wanted 120 connections out of 60. Measured:
#   106 pool timeouts, 106 of 300 events lost, 161 of 300 `download_count`
#   increments missing — and every request still returned 200.
#
# `db_echo` defaults to FALSE: this used to be a hard-coded `echo=True`, i.e.
# every statement AND every bound parameter logged in production (#326).
engine = create_async_engine(
    settings.database_url,
    echo=settings.db_echo,
    pool_pre_ping=True,
    pool_recycle=3600,
    pool_size=settings.db_pool_size,
    max_overflow=settings.db_max_overflow,
)
async_session = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)

# ANALYTICS pool (#326) — a SEPARATE, small pool for the fire-and-forget side
# writes (`app.services.engagement.record_event`), so a side write can never
# take a connection a request is waiting for. Separation, not a bigger number,
# is the fix: bounding the emits on the SHARED pool was measured to be WORSE
# than leaving them unbounded (397 pool timeouts vs 106), because a bounded
# emit that cannot get a connection blocks every emit behind it while the
# requests holding those connections wait for their own emits to finish.
#
# `max_overflow=0` makes the ceiling exact: analytics costs the database at
# most `engagement_max_concurrent_writes` connections, ever. Emits beyond that
# queue in memory under the semaphore in `record_event` (with an admission cap
# that drops and COUNTS rather than growing without bound), so they never even
# reach this pool's own checkout queue.
analytics_engine = create_async_engine(
    settings.database_url,
    echo=settings.db_echo,
    pool_pre_ping=True,
    pool_recycle=3600,
    pool_size=settings.engagement_max_concurrent_writes,
    max_overflow=0,
)
analytics_session = async_sessionmaker(
    analytics_engine, class_=AsyncSession, expire_on_commit=False
)


class Base(DeclarativeBase):
    pass


async def get_db():
    async with async_session() as session:
        yield session
