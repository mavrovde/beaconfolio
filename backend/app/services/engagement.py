"""Engagement analytics: recording, aggregation, retention, digest (#249).

One module owns the whole lifecycle of an ``EngagementEvent`` so the API layer
stays thin and the digest and the dashboard count the SAME thing — a second
copy of the aggregation is how two numbers start disagreeing.

Recording is deliberately best-effort: analytics must never change the outcome
of the flow it observes. ``record_event`` therefore writes through its OWN
session rather than the request's, and swallows its own failures.

WHY ITS OWN SESSION (this was a measured bug, not a preference): sharing the
caller's session makes "best effort" a lie. A failed event write has to
``rollback()``, and ``Session.rollback()`` is session-WIDE — it expires every
ORM object in the caller's identity map, so the caller's next attribute read
(``interaction.id``, ``active_cv.version``) becomes a lazy reload, i.e. sync IO
in an async context: ``MissingGreenlet``, and a 500 on a request that had
already succeeded. Owning the session makes the isolation structural instead of
asking every call site to remember it.

AND ITS OWN SESSION IS A SECOND POOL CONNECTION (#326), which is why the emits
are BOUNDED. Unbounded, they compete with request handlers for the same pool:
measured on `/cv/download`, 300 requests at concurrency 60 produced 106
`QueuePool limit … connection timed out` failures, 106 of 300 events silently
lost — and the requests still returned 200, so nothing surfaced it. At most
``engagement_max_concurrent_writes`` emits now hold a connection at a time, and
an emit that finds ``engagement_max_pending_events`` already waiting is dropped,
COUNTED and logged rather than queued without bound. Loss is never silent.
"""

import asyncio
import uuid
from datetime import UTC, date, datetime, time, timedelta
from typing import Any, cast

from sqlalchemy import delete, func, select
from sqlalchemy.engine import CursorResult
from sqlalchemy.ext.asyncio import AsyncSession

import app.database
from app.config import settings
from app.logger import logger
from app.models.cv_request import CvRequest
from app.models.engagement_event import ENGAGEMENT_KINDS, EngagementEvent
from app.models.interaction import Interaction
from app.services.email import email_service

# Which source table resolves the display label of a feed row (see
# ``recent_events``). The event itself stores no identity data — the label is
# read back from the record it points at, at render time, for the admin only.
_CV_KINDS = ("cv_request", "cv_download")

#: Emits currently holding OR waiting for a database connection (#326). Read
#: and written only from the event loop, so a plain int is the whole
#: synchronisation story — no lock, no race.
_pending_writes = 0
#: Emits refused because `_pending_writes` was already at the cap. Cumulative
#: for the life of the process; every increment is logged as it happens.
_dropped_events = 0
#: Created on first use so the bound tracks the setting even when a test
#: overrides it (a module-level Semaphore would freeze the value at import).
_write_slots: asyncio.Semaphore | None = None
_write_slots_bound: int | None = None


def dropped_event_count() -> int:
    """How many events this process refused to record because of backpressure.

    Non-zero means the database could not keep up with a burst and analytics is
    UNDER-reporting by exactly this much — the number that turns silent loss
    into a countable fact. Every drop is also logged at WARNING as it happens.
    """
    return _dropped_events


def reset_write_budget() -> None:
    """Drop the semaphore and the counters. Test helper.

    pytest-asyncio gives each test its own event loop, and an
    ``asyncio.Semaphore`` that has waiters on a closed loop is useless to the
    next one; resetting between tests keeps the budget per-test instead of
    per-process.
    """
    global _write_slots, _write_slots_bound, _pending_writes, _dropped_events
    _write_slots = None
    _write_slots_bound = None
    _pending_writes = 0
    _dropped_events = 0


def _slots() -> asyncio.Semaphore:
    """The shared write budget, rebuilt when the configured bound changes."""
    global _write_slots, _write_slots_bound
    bound = settings.engagement_max_concurrent_writes
    if _write_slots is None or _write_slots_bound != bound:
        _write_slots = asyncio.Semaphore(bound)
        _write_slots_bound = bound
    return _write_slots


async def record_event(
    kind: str,
    *,
    subject_id: uuid.UUID | None = None,
    payload: dict[str, Any] | None = None,
) -> bool:
    """Record one engagement event. Returns True when a row was written.

    ``False`` means "deliberately not recorded" (flag off) or "recording
    failed" — never a reason for the caller to fail. An unknown ``kind`` is a
    programming error, not a runtime condition, so it raises: a typo must not
    become a silent bucket nobody ever counts.

    Takes no session on purpose (see the module docstring): it opens a
    short-lived one of its own, so neither its commit nor its rollback can
    reach the request's transaction or identity map. ``app.database`` is
    referenced through the module, not imported by name, so the test suite's
    session redirect reaches this write too.

    CALL IT VIA ``BackgroundTasks``, not ``await``. Its own session means a
    second pool connection, and awaiting it inline puts that checkout plus an
    INSERT and a COMMIT on the visitor's critical path — for bookkeeping the
    visitor is not waiting for. Measured on ``/cv/download``, 60 requests after
    10 warm-ups: **6.5 ms mean inline vs 4.3 ms scheduled** (-2.1 ms, -32%);
    the review measured the same effect at +4.8 ms on other hardware, so treat
    the ratio as the durable number, not the milliseconds.

    Scheduling loses nothing: 210 download requests produced exactly 210
    events. A background task is also deterministic under the test client (the
    ASGI transport drains tasks before returning), so this does not trade
    latency for a flaky test — pinned by
    ``test_every_emission_is_scheduled_not_awaited``.

    BOUNDED (#326): the connection is taken under a semaphore of
    ``engagement_max_concurrent_writes`` slots, so however many visitors arrive
    at once, analytics can hold only that many of the pool's connections and
    the request path keeps the rest. Waiting for a slot costs the visitor
    nothing — this already runs after the response — but waiting *without
    bound* would cost memory, so an emit arriving with
    ``engagement_max_pending_events`` already in flight is dropped, counted
    (``dropped_event_count``) and logged instead.
    """
    global _pending_writes, _dropped_events
    if kind not in ENGAGEMENT_KINDS:
        raise ValueError(f"Unknown engagement kind '{kind}'")
    if not settings.engagement_analytics_enabled:
        return False
    if _pending_writes >= settings.engagement_max_pending_events:
        _dropped_events += 1
        logger.warning(
            f"Dropped engagement event '{kind}': "
            f"{_pending_writes} writes already pending "
            f"(cap {settings.engagement_max_pending_events}); "
            f"{_dropped_events} dropped so far"
        )
        return False
    _pending_writes += 1
    try:
        async with _slots():
            async with app.database.analytics_session() as session:
                session.add(
                    EngagementEvent(kind=kind, subject_id=subject_id, payload=payload)
                )
                await session.commit()
        return True
    except Exception as e:
        logger.error(f"Failed to record engagement event '{kind}': {e}")
        return False
    finally:
        _pending_writes -= 1


def _zero_counts() -> dict[str, int]:
    return dict.fromkeys(ENGAGEMENT_KINDS, 0)


async def totals(db: AsyncSession) -> dict[str, int]:
    """All-time count per kind, with every known kind present (zero included).

    A missing key and a zero are the same fact; always emitting the full set
    keeps the dashboard from having to guess.
    """
    rows = (
        await db.execute(
            select(EngagementEvent.kind, func.count(EngagementEvent.id)).group_by(
                EngagementEvent.kind
            )
        )
    ).all()
    counts = _zero_counts()
    for kind, count in rows:
        counts[kind] = int(count)
    return counts


async def counts_since(db: AsyncSession, since: datetime) -> dict[str, int]:
    """Count per kind for events at or after ``since`` — the digest's window."""
    rows = (
        await db.execute(
            select(EngagementEvent.kind, func.count(EngagementEvent.id))
            .where(EngagementEvent.created_at >= since)
            .group_by(EngagementEvent.kind)
        )
    ).all()
    counts = _zero_counts()
    for kind, count in rows:
        counts[kind] = int(count)
    return counts


def week_start(moment: datetime) -> date:
    """Monday of ``moment``'s week, in UTC — the trend's bucket key."""
    day = moment.astimezone(UTC).date()
    return day - timedelta(days=day.weekday())


async def weekly_trend(db: AsyncSession, weeks: int) -> list[dict[str, Any]]:
    """Per-week counts per kind for the last ``weeks`` weeks, oldest first.

    Empty weeks are emitted as zeros so a chart has a continuous axis instead
    of silently collapsing a quiet fortnight.

    ``AT TIME ZONE 'UTC'`` is load-bearing: ``date_trunc('week', <timestamptz>)``
    truncates in the SESSION timezone, so the same row would land in different
    buckets on a server configured for Europe/Berlin. Pinning UTC makes the
    bucket boundary a property of the data, not of the deployment.
    """
    first = week_start(datetime.now(UTC)) - timedelta(weeks=weeks - 1)
    window_start = datetime.combine(first, time.min, tzinfo=UTC)
    bucket_expr = func.date_trunc(
        "week", EngagementEvent.created_at.op("AT TIME ZONE")("UTC")
    )
    rows = (
        await db.execute(
            select(
                bucket_expr.label("wk"),
                EngagementEvent.kind,
                func.count(EngagementEvent.id),
            )
            .where(EngagementEvent.created_at >= window_start)
            .group_by("wk", EngagementEvent.kind)
        )
    ).all()

    buckets: dict[date, dict[str, int]] = {
        first + timedelta(weeks=i): _zero_counts() for i in range(weeks)
    }
    for bucket, kind, count in rows:
        # A future-dated row (clock skew on the writer) passes the window
        # filter but has no bucket; it is counted in `totals`, not charted.
        target = buckets.get(bucket.date())
        if target is not None:
            target[kind] = int(count)
    return [
        {"week_start": day.isoformat(), "counts": counts}
        for day, counts in sorted(buckets.items())
    ]


def _display_label(name: str, company: str | None) -> str:
    """ONE definition of a feed row's label, shared by both source tables — two
    copies of this ternary would be two coverage branches and, eventually, two
    different formats."""
    return f"{name} ({company})" if company else name


async def _labels_for(
    db: AsyncSession, events: list[EngagementEvent]
) -> dict[uuid.UUID, str]:
    """Resolve display labels from the SOURCE records (never from the event).

    Two batched queries, not one per row: the feed is a list.
    """
    cv_ids = {
        e.subject_id for e in events if e.kind in _CV_KINDS and e.subject_id is not None
    }
    interaction_ids = {
        e.subject_id
        for e in events
        if e.kind not in _CV_KINDS and e.subject_id is not None
    }
    labels: dict[uuid.UUID, str] = {}
    if cv_ids:
        rows = (
            await db.execute(
                select(CvRequest.id, CvRequest.name, CvRequest.company).where(
                    CvRequest.id.in_(cv_ids)
                )
            )
        ).all()
        for row_id, name, company in rows:
            labels[row_id] = _display_label(name, company)
    if interaction_ids:
        interaction_rows = (
            await db.execute(
                select(Interaction.id, Interaction.name, Interaction.company).where(
                    Interaction.id.in_(interaction_ids)
                )
            )
        ).all()
        for row_id, name, company in interaction_rows:
            labels[row_id] = _display_label(name, company)
    return labels


async def recent_events(db: AsyncSession, limit: int) -> list[dict[str, Any]]:
    """Newest-first activity feed, each row labelled from its source record."""
    events = list(
        (
            await db.execute(
                select(EngagementEvent)
                .order_by(EngagementEvent.created_at.desc())
                .limit(limit)
            )
        )
        .scalars()
        .all()
    )
    labels = await _labels_for(db, events)
    return [
        {
            "id": e.id,
            "kind": e.kind,
            "subject_id": e.subject_id,
            # None when the source record is gone (or never existed): the
            # event still counts, it just has nobody to name.
            "label": labels.get(e.subject_id) if e.subject_id else None,
            "payload": e.payload,
            "created_at": e.created_at.isoformat(),
        }
        for e in events
    ]


async def purge_old_events(db: AsyncSession) -> int:
    """Delete events older than the retention window; returns the row count.

    ``engagement_retention_days = 0`` keeps nothing (cutoff = now); a NEGATIVE
    value disables purging. Only events are deleted — the ``CvRequest`` /
    ``Interaction`` records they point at are never touched.
    """
    days = settings.engagement_retention_days
    if days < 0:
        return 0
    cutoff = datetime.now(UTC) - timedelta(days=days)
    result = await db.execute(
        delete(EngagementEvent).where(EngagementEvent.created_at < cutoff)
    )
    await db.commit()
    # A DELETE always yields a CursorResult; `Result` (the declared return type
    # of `execute`) is the wider base that does not carry `rowcount`.
    return int(cast("CursorResult[Any]", result).rowcount)


async def send_weekly_digest(db: AsyncSession) -> bool:
    """Email the owner a one-week engagement summary.

    Returns False when SMTP is unconfigured — the email service already treats
    that as "skip quietly", so an unconfigured host simply never sends.

    ``smtplib`` is blocking and time-bounded by ``smtp_timeout_seconds``; the
    send therefore runs off the event loop, exactly like the other blocking IO
    this app performs from a coroutine.
    """
    since = datetime.now(UTC) - timedelta(days=7)
    counts = await counts_since(db, since)
    return await asyncio.to_thread(
        email_service.send_engagement_digest, counts=counts, since=since
    )
