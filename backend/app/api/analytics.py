"""Private engagement dashboard — admin only (#249).

Everything here is owner-visible intelligence about who engaged with the
portfolio, so every route sits behind ``get_current_admin_user`` at the ROUTER
level: an analytics endpoint that answered unauthenticated would leak recruiter
activity to the internet.

The feature flag is enforced by a second router-level dependency: with
``ENGAGEMENT_ANALYTICS_ENABLED=false`` these routes 404, so the dashboard has
no route to reach — the same "off means gone" contract the recording side
keeps by never writing a row.
"""

import uuid
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.database import get_db
from app.models.engagement_event import ENGAGEMENT_KINDS
from app.services import engagement
from app.services.auth import get_current_admin_user


def _require_enabled() -> None:
    if not settings.engagement_analytics_enabled:
        raise HTTPException(status_code=404, detail="Engagement analytics is disabled")


router = APIRouter(
    prefix="/admin/analytics",
    tags=["admin-analytics"],
    dependencies=[Depends(get_current_admin_user), Depends(_require_enabled)],
)


class WeekBucket(BaseModel):
    """One Monday-anchored week of the trend, zero-filled."""

    week_start: str
    counts: dict[str, int]


class FeedItem(BaseModel):
    id: uuid.UUID
    kind: str
    subject_id: uuid.UUID | None
    # Resolved from the source record at read time — the event stores no name.
    label: str | None
    payload: dict[str, Any] | None
    created_at: str


class EngagementSummary(BaseModel):
    kinds: list[str]
    totals: dict[str, int]
    weeks: list[WeekBucket]
    recent: list[FeedItem]


class PurgeResult(BaseModel):
    deleted: int
    retention_days: int


class DigestResult(BaseModel):
    sent: bool


@router.get("/engagement", response_model=EngagementSummary)
async def get_engagement(
    weeks: int = Query(default=8, ge=1, le=engagement.MAX_TREND_WEEKS),
    limit: int = Query(default=20, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
) -> EngagementSummary:
    """Totals, a per-week trend and the recent-activity feed in one call.

    One request, because the dashboard renders them as one screen — three
    endpoints would mean three round-trips showing three moments in time.
    """
    return EngagementSummary(
        kinds=list(ENGAGEMENT_KINDS),
        totals=await engagement.totals(db),
        weeks=[WeekBucket(**w) for w in await engagement.weekly_trend(db, weeks)],
        recent=[FeedItem(**item) for item in await engagement.recent_events(db, limit)],
    )


@router.post("/purge", response_model=PurgeResult)
async def purge_events(db: AsyncSession = Depends(get_db)) -> PurgeResult:
    """Apply the retention knob now (there is no scheduler in this app)."""
    deleted = await engagement.purge_old_events(db)
    return PurgeResult(
        deleted=deleted, retention_days=settings.engagement_retention_days
    )


@router.post("/digest", response_model=DigestResult)
async def send_digest(db: AsyncSession = Depends(get_db)) -> DigestResult:
    """Send the weekly summary email now.

    ``sent=false`` is a normal answer, not an error: it is what an
    unconfigured SMTP host produces, and the UI says so.
    """
    return DigestResult(sent=await engagement.send_weekly_digest(db))
