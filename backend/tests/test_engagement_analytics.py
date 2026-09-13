"""Engagement analytics: events, dashboard, retention, digest (#249).

The load-bearing claim this file pins is that a REPEATED download is a
countable occurrence: ``CvRequest.download_count`` cannot produce a per-week
trend, which is the whole reason the event table exists.
"""

import asyncio
import uuid
from contextlib import asynccontextmanager
from datetime import UTC, datetime, timedelta
from itertools import pairwise
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import BackgroundTasks
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.config import settings
from app.models.cv_document import CvDocument
from app.models.cv_request import CvRequest
from app.models.engagement_event import (
    ENGAGEMENT_KINDS,
    EngagementEvent,
    engagement_label,
)
from app.models.interaction import Interaction
from app.services import engagement
from app.services.email import EmailService

ANALYTICS_URL = f"{settings.api_prefix}/admin/analytics"
CONTACT_URL = f"{settings.api_prefix}/interactions/contact"


async def _seed_cv(db_session, version: str = "v9.9") -> CvDocument:
    doc = CvDocument(
        id=uuid.uuid4(),
        filename="cv.pdf",
        data=b"%PDF-1.4 test",
        version=version,
        is_active=True,
    )
    db_session.add(doc)
    await db_session.commit()
    return doc


async def _seed_event(
    db_session,
    kind: str,
    *,
    age_days: float = 0.0,
    subject_id: uuid.UUID | None = None,
    payload: dict | None = None,
) -> EngagementEvent:
    event = EngagementEvent(
        kind=kind,
        subject_id=subject_id,
        payload=payload,
        created_at=datetime.now(UTC) - timedelta(days=age_days),
    )
    db_session.add(event)
    await db_session.commit()
    return event


async def _post_contact(client: AsyncClient, **overrides):
    body = {
        "name": "Rita Recruiter",
        "email": "rita@agency.example",
        "company": "Agency GmbH",
        "message": "We have a role you would be perfect for.",
    }
    body.update(overrides)
    return await client.post(CONTACT_URL, json=body)


# --- recording ---------------------------------------------------------------


@pytest.mark.asyncio
async def test_record_event_writes_a_row(db_session):
    assert await engagement.record_event("cv_request") is True
    rows = (await db_session.execute(select(EngagementEvent))).scalars().all()
    assert len(rows) == 1
    assert rows[0].kind == "cv_request"


@pytest.mark.asyncio
async def test_record_event_rejects_an_unknown_kind():
    """A typo must fail loudly, not become a bucket nobody ever counts."""
    with pytest.raises(ValueError, match="Unknown engagement kind"):
        await engagement.record_event("cv_downlaod")


@pytest.mark.asyncio
async def test_record_event_writes_nothing_when_the_flag_is_off(db_session):
    with patch("app.config.settings.engagement_analytics_enabled", False):
        assert await engagement.record_event("cv_request") is False
    assert (await db_session.execute(select(EngagementEvent))).scalars().all() == []


@pytest.mark.asyncio
async def test_record_event_swallows_its_own_failure():
    """Analytics never changes the outcome of the flow it observes."""
    with patch(
        "app.services.engagement.EngagementEvent",
        side_effect=RuntimeError("column exploded"),
    ):
        assert await engagement.record_event("cv_request") is False


@pytest.mark.asyncio
async def test_a_failed_recording_leaves_the_callers_session_usable(db_session):
    """Regression: recording must not touch the CALLER's transaction.

    While `record_event` shared the request's session, its failure path had to
    `rollback()` — a session-WIDE operation that expires every loaded object,
    so the caller's next attribute read became a lazy reload (sync IO in an
    async context → MissingGreenlet → a 500 on a request that had already
    succeeded). Both flows hit it: this asserts the isolation directly, and
    `test_contact_still_succeeds_when_recording_fails` /
    `test_cv_request_survives_inbox_indexing_failure` assert it end-to-end.
    """
    cv_request = CvRequest(
        name="Rita Recruiter",
        email="rita@agency.example",
        company="Agency GmbH",
        message="Please send the CV",
        consent_given=True,
    )
    db_session.add(cv_request)
    await db_session.commit()

    with patch(
        "app.services.engagement.EngagementEvent",
        side_effect=RuntimeError("column exploded"),
    ):
        assert await engagement.record_event("cv_request") is False

    # Not expired: readable without emitting a reload the caller cannot await.
    assert cv_request.name == "Rita Recruiter"


# --- connection budget (#326) ------------------------------------------------
#
# The emit runs WHILE the request that scheduled it still holds its own
# connection (a background task is part of the ASGI cycle), so an emit drawing
# from the REQUEST pool means one request wants two connections. Measured on
# `/cv/download`, 300 requests at concurrency 60: 106 `QueuePool limit …
# connection timed out`, 106 of 300 events lost, every request still 200.


@pytest.mark.asyncio
async def test_emit_never_draws_from_the_request_pool(db_session, monkeypatch):
    """At the SEAM: which factory does the emit open its session from?

    Asserting on the written row cannot see this — the row is identical either
    way — so spy on the two factories and assert which one was CALLED.
    """
    import app.database
    from conftest import get_test_async_session

    used: list[str] = []
    real = get_test_async_session()

    def request_pool(*args, **kwargs):
        used.append("request")
        return real(*args, **kwargs)

    def analytics_pool(*args, **kwargs):
        used.append("analytics")
        return real(*args, **kwargs)

    monkeypatch.setattr(app.database, "async_session", request_pool)
    monkeypatch.setattr(app.database, "analytics_session", analytics_pool)

    assert await engagement.record_event("cv_request") is True
    assert used == ["analytics"]


@pytest.mark.asyncio
async def test_emits_land_while_every_request_connection_is_in_use(
    db_session, monkeypatch
):
    """The starvation shape itself, on REAL pools.

    The request pool is exhausted (its only connection is held, as an in-flight
    request would) and six emits arrive at once. They must all be written.
    Sharing the pool here is not merely slower — it deadlocks: the connection
    is held by something that is waiting for the emits, so every emit burns its
    `pool_timeout` and returns False.
    """
    import app.database
    from conftest import _test_database_url

    url = _test_database_url()
    request_engine = create_async_engine(
        url, pool_size=1, max_overflow=0, pool_timeout=2, echo=False
    )
    analytics_engine = create_async_engine(
        url, pool_size=2, max_overflow=0, pool_timeout=2, echo=False
    )
    monkeypatch.setattr(
        app.database,
        "async_session",
        async_sessionmaker(request_engine, expire_on_commit=False),
    )
    monkeypatch.setattr(
        app.database,
        "analytics_session",
        async_sessionmaker(analytics_engine, expire_on_commit=False),
    )
    try:
        async with request_engine.connect():  # the pool is now empty
            results = await asyncio.gather(
                *(engagement.record_event("cv_download") for _ in range(6))
            )
        assert results == [True] * 6
    finally:
        await request_engine.dispose()
        await analytics_engine.dispose()

    rows = (await db_session.execute(select(EngagementEvent))).scalars().all()
    assert len(rows) == 6


@pytest.mark.asyncio
async def test_concurrent_emits_never_exceed_the_configured_budget(
    db_session, monkeypatch
):
    """Analytics holds at most `engagement_max_concurrent_writes` connections.

    Unbounded, ten simultaneous emits hold ten connections; the bound is what
    keeps that slice small enough that the request path always has room.
    """
    import app.database
    from conftest import get_test_async_session

    monkeypatch.setattr(settings, "engagement_max_concurrent_writes", 2)
    engagement.reset_write_budget()
    real = get_test_async_session()
    live = 0
    peak = 0

    @asynccontextmanager
    async def counting_session():
        nonlocal live, peak
        live += 1
        peak = max(peak, live)
        try:
            async with real() as session:
                yield session
        finally:
            live -= 1

    monkeypatch.setattr(app.database, "analytics_session", counting_session)

    results = await asyncio.gather(
        *(engagement.record_event("cv_download") for _ in range(10))
    )
    assert results == [True] * 10
    assert peak <= 2
    rows = (await db_session.execute(select(EngagementEvent))).scalars().all()
    assert len(rows) == 10


@pytest.mark.asyncio
async def test_emits_beyond_the_pending_cap_are_dropped_counted_and_logged(
    db_session, monkeypatch
):
    """Backpressure, not unbounded queueing — and never SILENT loss.

    One write slot is held open, so the third and fourth emits arrive with the
    pending cap already reached. They are refused, counted and logged; the two
    admitted ones still land.
    """
    import app.database
    from conftest import get_test_async_session

    monkeypatch.setattr(settings, "engagement_max_concurrent_writes", 1)
    monkeypatch.setattr(settings, "engagement_max_pending_events", 2)
    engagement.reset_write_budget()
    real = get_test_async_session()
    gate = asyncio.Event()

    @asynccontextmanager
    async def gated_session():
        await gate.wait()
        async with real() as session:
            yield session

    monkeypatch.setattr(app.database, "analytics_session", gated_session)

    with patch("app.services.engagement.logger") as log:
        tasks = [
            asyncio.create_task(engagement.record_event("cv_download"))
            for _ in range(4)
        ]
        await asyncio.sleep(0.05)  # let all four reach their decision point
        gate.set()
        results = await asyncio.gather(*tasks)

        assert results == [True, True, False, False]
        assert engagement.dropped_event_count() == 2
        assert log.warning.call_count == 2
        message = log.warning.call_args.args[0]
        assert "Dropped engagement event 'cv_download'" in message
        assert "2 dropped so far" in message

    rows = (await db_session.execute(select(EngagementEvent))).scalars().all()
    assert len(rows) == 2


def test_pool_sizes_are_explicit_and_sql_echo_is_off():
    """The engines' sizing comes from settings, not from literals nobody chose,
    and `echo` is OFF — it was a hard-coded `echo=True` in production (#326)."""
    import app.database

    assert settings.db_echo is False
    assert app.database.engine.echo is False
    assert app.database.engine.pool.size() == settings.db_pool_size
    assert app.database.engine.pool._max_overflow == settings.db_max_overflow
    # Analytics is a SEPARATE pool, hard-capped at the emit budget.
    assert app.database.analytics_engine is not app.database.engine
    assert (
        app.database.analytics_engine.pool.size()
        == settings.engagement_max_concurrent_writes
    )
    assert app.database.analytics_engine.pool._max_overflow == 0


# --- aggregation -------------------------------------------------------------


@pytest.mark.asyncio
async def test_totals_zero_fill_every_known_kind(db_session):
    assert await engagement.totals(db_session) == dict.fromkeys(ENGAGEMENT_KINDS, 0)


@pytest.mark.asyncio
async def test_totals_count_per_kind(db_session):
    await _seed_event(db_session, "cv_download")
    await _seed_event(db_session, "cv_download")
    await _seed_event(db_session, "contact_submitted")
    assert await engagement.totals(db_session) == {
        "cv_request": 0,
        "cv_download": 2,
        "contact_submitted": 1,
    }


@pytest.mark.asyncio
async def test_counts_since_excludes_older_events(db_session):
    await _seed_event(db_session, "cv_request", age_days=30)
    await _seed_event(db_session, "cv_request", age_days=1)
    since = datetime.now(UTC) - timedelta(days=7)
    assert (await engagement.counts_since(db_session, since))["cv_request"] == 1


def test_week_start_is_the_monday_in_utc():
    # A Sunday 23:00 UTC still belongs to the week that started six days ago.
    sunday = datetime(2026, 9, 6, 23, 0, tzinfo=UTC)
    assert engagement.week_start(sunday).isoformat() == "2026-08-31"


@pytest.mark.asyncio
async def test_weekly_trend_zero_fills_quiet_weeks(db_session):
    await _seed_event(db_session, "cv_download", age_days=14)
    trend = await engagement.weekly_trend(db_session, 4)

    assert len(trend) == 4
    # Oldest first, one Monday apart, continuous — a chart axis with no holes.
    starts = [datetime.fromisoformat(w["week_start"]).date() for w in trend]
    assert starts == sorted(starts)
    assert all((b - a).days == 7 for a, b in pairwise(starts))
    assert sum(w["counts"]["cv_download"] for w in trend) == 1
    # Every bucket carries every kind, so the UI never has to guess.
    assert all(set(w["counts"]) == set(ENGAGEMENT_KINDS) for w in trend)


@pytest.mark.asyncio
async def test_weekly_trend_ignores_a_future_dated_event(db_session):
    """Clock skew on the writer must not invent a bucket past the last week."""
    await _seed_event(db_session, "cv_request", age_days=-21)
    trend = await engagement.weekly_trend(db_session, 2)
    assert len(trend) == 2
    assert sum(w["counts"]["cv_request"] for w in trend) == 0
    # It is still counted in the all-time totals.
    assert (await engagement.totals(db_session))["cv_request"] == 1


@pytest.mark.asyncio
async def test_weekly_trend_windows_out_older_events(db_session):
    await _seed_event(db_session, "cv_request", age_days=60)
    trend = await engagement.weekly_trend(db_session, 2)
    assert sum(w["counts"]["cv_request"] for w in trend) == 0


# --- activity feed -----------------------------------------------------------


@pytest.mark.asyncio
async def test_feed_labels_come_from_the_source_records(db_session):
    cv_request = CvRequest(
        name="Rita Recruiter",
        email="rita@agency.example",
        company="Agency GmbH",
        message="Please send the CV",
        consent_given=True,
    )
    interaction = Interaction(
        source="contact_form",
        status="new",
        name="Solo Sam",
        email="sam@example.com",
        company=None,
        message="hello there",
    )
    db_session.add_all([cv_request, interaction])
    await db_session.commit()

    await _seed_event(db_session, "cv_download", subject_id=cv_request.id)
    await _seed_event(db_session, "contact_submitted", subject_id=interaction.id)

    feed = await engagement.recent_events(db_session, 10)
    labels = {item["kind"]: item["label"] for item in feed}
    assert labels["cv_download"] == "Rita Recruiter (Agency GmbH)"
    # No company on the source record → the name alone, never an empty paren.
    assert labels["contact_submitted"] == "Solo Sam"


@pytest.mark.asyncio
async def test_feed_survives_a_missing_or_absent_subject(db_session):
    await _seed_event(db_session, "cv_request", subject_id=uuid.uuid4())
    await _seed_event(db_session, "contact_submitted", subject_id=None)
    feed = await engagement.recent_events(db_session, 10)
    assert [item["label"] for item in feed] == [None, None]


@pytest.mark.asyncio
async def test_feed_is_newest_first_and_limited(db_session):
    await _seed_event(db_session, "cv_request", age_days=2)
    await _seed_event(db_session, "cv_download", age_days=1)
    feed = await engagement.recent_events(db_session, 1)
    assert [item["kind"] for item in feed] == ["cv_download"]


@pytest.mark.asyncio
async def test_feed_is_empty_without_events(db_session):
    assert await engagement.recent_events(db_session, 10) == []


# --- retention ---------------------------------------------------------------


@pytest.mark.asyncio
async def test_purge_deletes_old_events_and_keeps_recent_ones(db_session):
    await _seed_event(db_session, "cv_request", age_days=400)
    await _seed_event(db_session, "cv_request", age_days=1)
    with patch("app.config.settings.engagement_retention_days", 365):
        assert await engagement.purge_old_events(db_session) == 1
    remaining = (await db_session.execute(select(EngagementEvent))).scalars().all()
    assert len(remaining) == 1


@pytest.mark.asyncio
async def test_purge_with_zero_retention_keeps_nothing_but_spares_the_sources(
    db_session,
):
    """The issue's verify step: retention 0 → events gone, CvRequest intact."""
    cv_request = CvRequest(
        name="Rita Recruiter",
        email="rita@agency.example",
        company="Agency GmbH",
        message="Please send the CV",
        consent_given=True,
    )
    db_session.add(cv_request)
    await db_session.commit()
    await _seed_event(db_session, "cv_download", subject_id=cv_request.id)

    with patch("app.config.settings.engagement_retention_days", 0):
        assert await engagement.purge_old_events(db_session) == 1

    assert (await db_session.execute(select(EngagementEvent))).scalars().all() == []
    survivors = (await db_session.execute(select(CvRequest))).scalars().all()
    assert len(survivors) == 1


@pytest.mark.asyncio
async def test_negative_retention_disables_purging(db_session):
    await _seed_event(db_session, "cv_request", age_days=5000)
    with patch("app.config.settings.engagement_retention_days", -1):
        assert await engagement.purge_old_events(db_session) == 0
    assert len((await db_session.execute(select(EngagementEvent))).scalars().all()) == 1


# --- digest ------------------------------------------------------------------


@pytest.mark.asyncio
async def test_digest_is_skipped_when_smtp_is_unconfigured(db_session):
    """Rule 10 holds: with no smtp_host nothing outbound is attempted."""
    with patch("app.config.settings.smtp_host", ""):
        assert await engagement.send_weekly_digest(db_session) is False


@pytest.mark.asyncio
async def test_digest_sends_the_last_seven_days(db_session):
    await _seed_event(db_session, "cv_download", age_days=1)
    await _seed_event(db_session, "cv_download", age_days=30)
    with patch(
        "app.services.engagement.email_service.send_engagement_digest",
        return_value=True,
    ) as send:
        assert await engagement.send_weekly_digest(db_session) is True
    assert send.call_args.kwargs["counts"]["cv_download"] == 1


def test_digest_email_body_carries_the_counts():
    service = EmailService()
    with (
        patch("smtplib.SMTP") as mock_smtp,
        patch("app.config.settings.smtp_host", "localhost"),
        patch("app.config.settings.smtp_user", ""),
        patch("app.config.settings.smtp_password", ""),
    ):
        mock_server = MagicMock()
        mock_smtp.return_value.__enter__.return_value = mock_server
        assert (
            service.send_engagement_digest(
                counts={"cv_request": 2, "cv_download": 3, "contact_submitted": 0},
                since=datetime(2026, 9, 1, tzinfo=UTC),
            )
            is True
        )
    msg = mock_server.send_message.call_args.args[0]
    body = msg.get_content()
    # The digest names an event exactly as the dashboard does (one label map).
    assert "CV downloads: 3" in body
    assert "Total events: 5" in body
    # Counts only — the digest carries no recruiter identity off the server.
    assert msg["To"] == settings.admin_email


def test_engagement_label_falls_back_for_an_unmapped_kind():
    """A kind added without a label must still read as words in the digest,
    never crash it — the digest is the surface with no UI to fix it in."""
    assert engagement_label("cv_download") == "CV downloads"
    assert engagement_label("link_visit") == "Link visit"


def test_digest_email_is_skipped_without_smtp_host():
    with patch("app.config.settings.smtp_host", ""):
        assert (
            EmailService().send_engagement_digest(
                counts={"cv_request": 1}, since=datetime.now(UTC)
            )
            is False
        )


# --- the flows that emit -----------------------------------------------------


@pytest.mark.asyncio
async def test_cv_request_and_every_download_are_recorded(client, db_session):
    """One row PER DOWNLOAD — the fact `download_count` cannot express."""
    await _seed_cv(db_session, version="v4.2")
    with patch("app.api.cv.process_email_notifications", new_callable=AsyncMock):
        resp = await client.post(
            f"{settings.api_prefix}/cv/request",
            json={
                "name": "Rita Recruiter",
                "email": "rita@agency.example",
                "company": "Agency GmbH",
                "message": "Interested in your profile.",
            },
        )
    assert resp.status_code == 200
    download_url = resp.json()["download_url"]

    assert (await client.get(download_url)).status_code == 200
    assert (await client.get(download_url)).status_code == 200

    events = (
        (
            await db_session.execute(
                select(EngagementEvent).order_by(EngagementEvent.created_at)
            )
        )
        .scalars()
        .all()
    )
    assert [e.kind for e in events] == ["cv_request", "cv_download", "cv_download"]
    assert events[0].payload == {"cv_version": "v4.2"}

    cv_request = (await db_session.execute(select(CvRequest))).scalars().one()
    # The event references the existing record instead of copying identity.
    assert {e.subject_id for e in events} == {cv_request.id}
    assert cv_request.download_count == 2


@pytest.mark.asyncio
async def test_every_emission_is_scheduled_not_awaited(client, db_session):
    """Recording must not sit on the visitor's critical path.

    Its own session means a second pool connection, so awaiting the INSERT
    inline cost a measured +4.8 ms per `/cv/download`. This asserts the SHAPE
    that keeps it off the response path — the emit is handed to
    `BackgroundTasks` — rather than a duration, which would be a flaky way to
    assert a design decision. Reverting any call site to `await record_event(...)`
    still records the event, so only this test would notice.
    """
    await _seed_cv(db_session)
    scheduled: list[str] = []
    original_add_task = BackgroundTasks.add_task

    def spy(self, func, *args, **kwargs):
        scheduled.append(getattr(func, "__name__", repr(func)))
        return original_add_task(self, func, *args, **kwargs)

    with (
        patch("app.api.cv.process_email_notifications", new_callable=AsyncMock),
        patch.object(BackgroundTasks, "add_task", spy),
    ):
        resp = await client.post(
            f"{settings.api_prefix}/cv/request",
            json={
                "name": "Rita Recruiter",
                "email": "rita@agency.example",
                "message": "Interested in your profile.",
            },
        )
        assert resp.status_code == 200
        assert (await client.get(resp.json()["download_url"])).status_code == 200
        assert (await _post_contact(client)).status_code == 201

    # One scheduled emit per flow: request, download, contact.
    assert scheduled.count("record_event") == 3
    # ...and scheduling still means recorded: the tasks ran.
    kinds = {
        e.kind
        for e in (await db_session.execute(select(EngagementEvent))).scalars().all()
    }
    assert kinds == {"cv_request", "cv_download", "contact_submitted"}


@pytest.mark.asyncio
async def test_download_without_req_id_records_nothing(client, db_session):
    await _seed_cv(db_session)
    assert (await client.get(f"{settings.api_prefix}/cv/download")).status_code == 200
    assert (await db_session.execute(select(EngagementEvent))).scalars().all() == []


@pytest.mark.asyncio
async def test_contact_submission_is_recorded(client, db_session):
    assert (await _post_contact(client)).status_code == 201
    event = (await db_session.execute(select(EngagementEvent))).scalars().one()
    interaction = (await db_session.execute(select(Interaction))).scalars().one()
    assert event.kind == "contact_submitted"
    assert event.subject_id == interaction.id
    assert event.payload is None


@pytest.mark.asyncio
async def test_contact_still_succeeds_when_recording_fails(client, db_session):
    """Regression: analytics is best-effort — a broken event write must not
    cost the owner a recruiter message."""
    with patch(
        "app.services.engagement.EngagementEvent",
        side_effect=RuntimeError("column exploded"),
    ):
        resp = await _post_contact(client)
    assert resp.status_code == 201
    assert len((await db_session.execute(select(Interaction))).scalars().all()) == 1


@pytest.mark.asyncio
async def test_the_flag_off_writes_no_events_on_a_cv_request(client, db_session):
    await _seed_cv(db_session)
    with (
        patch("app.config.settings.engagement_analytics_enabled", False),
        patch("app.api.cv.process_email_notifications", new_callable=AsyncMock),
    ):
        resp = await client.post(
            f"{settings.api_prefix}/cv/request",
            json={
                "name": "Rita Recruiter",
                "email": "rita@agency.example",
                "message": "Interested in your profile.",
            },
        )
    assert resp.status_code == 200
    # Existing behavior unchanged: the domain record is still written.
    assert len((await db_session.execute(select(CvRequest))).scalars().all()) == 1
    assert (await db_session.execute(select(EngagementEvent))).scalars().all() == []


# --- the admin dashboard API -------------------------------------------------


@pytest.mark.asyncio
async def test_engagement_requires_admin(clean_client: AsyncClient):
    """Recruiter activity is owner-only: no token, no data."""
    assert (await clean_client.get(f"{ANALYTICS_URL}/engagement")).status_code == 401
    assert (await clean_client.post(f"{ANALYTICS_URL}/purge")).status_code == 401
    assert (await clean_client.post(f"{ANALYTICS_URL}/digest")).status_code == 401


@pytest.mark.asyncio
async def test_flag_off_still_answers_anonymous_callers_with_401(
    clean_client: AsyncClient,
):
    """Order of the two router dependencies is itself a disclosure decision.

    Auth runs BEFORE the flag check, so a stranger gets 401 either way and
    cannot use the 404-vs-401 difference to learn whether this server collects
    engagement analytics. Only an authenticated owner sees the 404 that means
    "switched off". Reversing the dependency order would leak that bit.
    """
    with patch("app.config.settings.engagement_analytics_enabled", False):
        assert (
            await clean_client.get(f"{ANALYTICS_URL}/engagement")
        ).status_code == 401
        assert (await clean_client.post(f"{ANALYTICS_URL}/purge")).status_code == 401
        assert (await clean_client.post(f"{ANALYTICS_URL}/digest")).status_code == 401


@pytest.mark.asyncio
async def test_engagement_summary_shape(client: AsyncClient, db_session):
    cv_request = CvRequest(
        name="Rita Recruiter",
        email="rita@agency.example",
        company="Agency GmbH",
        message="Please send the CV",
        consent_given=True,
    )
    db_session.add(cv_request)
    await db_session.commit()
    await _seed_event(db_session, "cv_download", subject_id=cv_request.id)

    resp = await client.get(f"{ANALYTICS_URL}/engagement", params={"weeks": 3})
    assert resp.status_code == 200
    data = resp.json()
    assert data["kinds"] == list(ENGAGEMENT_KINDS)
    assert data["totals"]["cv_download"] == 1
    assert len(data["weeks"]) == 3
    assert data["weeks"][-1]["counts"]["cv_download"] == 1
    assert data["recent"][0]["label"] == "Rita Recruiter (Agency GmbH)"
    assert data["recent"][0]["subject_id"] == str(cv_request.id)


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "params",
    [{"weeks": 0}, {"weeks": 53}, {"limit": 0}, {"limit": 101}],
)
async def test_engagement_rejects_out_of_range_windows(client: AsyncClient, params):
    resp = await client.get(f"{ANALYTICS_URL}/engagement", params=params)
    assert resp.status_code == 422


@pytest.mark.asyncio
async def test_purge_endpoint_reports_what_it_deleted(client: AsyncClient, db_session):
    await _seed_event(db_session, "cv_request", age_days=400)
    with patch("app.config.settings.engagement_retention_days", 365):
        resp = await client.post(f"{ANALYTICS_URL}/purge")
    assert resp.status_code == 200
    assert resp.json() == {"deleted": 1, "retention_days": 365}


@pytest.mark.asyncio
async def test_digest_endpoint_reports_a_skipped_send(client: AsyncClient):
    with patch("app.config.settings.smtp_host", ""):
        resp = await client.post(f"{ANALYTICS_URL}/digest")
    assert resp.status_code == 200
    assert resp.json() == {"sent": False}


@pytest.mark.asyncio
async def test_the_flag_off_removes_the_dashboard_routes(client: AsyncClient):
    """Flag off = no route to reach, not an empty dashboard."""
    with patch("app.config.settings.engagement_analytics_enabled", False):
        assert (await client.get(f"{ANALYTICS_URL}/engagement")).status_code == 404
        assert (await client.post(f"{ANALYTICS_URL}/purge")).status_code == 404
        assert (await client.post(f"{ANALYTICS_URL}/digest")).status_code == 404
