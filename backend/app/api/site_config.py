"""Public site-identity configuration (#65).

The frontend is shipped as a prebuilt image; identity must therefore be a
RUNTIME concern. This endpoint is the single source the public app reads at
bootstrap — owner name, headline, canonical URL, social links, analytics id —
all derived from env-driven settings (`app.config.Settings`), never hardcoded
in components. The payload is public by design and must contain ONLY data the
public site already renders — notably NOT admin_email, which doubles as the
admin login username (#255 review: publishing it unauthenticated was an
information leak with zero consumers). Visitor-facing contact comes from the
profile data, not from here.
"""

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.site_settings import read_availability_or_default, read_theme_or_default
from app.config import settings
from app.database import get_db

router = APIRouter(prefix="/config", tags=["config"])


class SiteConfig(BaseModel):
    site_name: str
    site_url: str
    owner_name: str
    owner_headline: str
    owner_description: str
    social_links: list[str]
    analytics_id: str
    # GTM container id (#447). When non-empty the client installs the container
    # and does NOT also install gtag — two installs of one measurement double
    # count. Absent on an older backend; the client normalizes that to "".
    gtm_container_id: str
    # Runtime, admin-editable (#271) — the job-search state the hero renders.
    # Public by design: its whole purpose is to be shown to visitors.
    availability: str
    # AI-crawler policy (#252): "allow" (default) or "deny". The SSR-generated
    # robots.txt reads it from here, so flipping the switch is an env change on
    # a prebuilt image — no rebuild. Being read by recruiter-side AI is the
    # point of this product, hence allow-by-default; an owner who objects sets
    # AI_CRAWLER_POLICY=deny.
    ai_crawler_policy: str
    # Runtime, admin-editable (#339) — which of the five preset token sets the
    # public site paints itself with. Served here rather than from env because
    # it is a choice the owner makes from the admin panel, not a deployment
    # fact; the app stamps it onto the root element DURING SSR so the first
    # byte already carries the right theme and there is no flash of the wrong
    # one. Absent on an older backend; the client normalizes that to the
    # default the same way it does `gtm_container_id`.
    theme: str


@router.get("/site", response_model=SiteConfig)
async def get_site_config(db: AsyncSession = Depends(get_db)) -> SiteConfig:
    """Return the site's public identity configuration."""
    return SiteConfig(
        site_name=settings.site_name,
        site_url=settings.site_url.rstrip("/"),
        owner_name=settings.owner_name,
        owner_headline=settings.owner_headline,
        owner_description=settings.owner_description,
        social_links=[s.strip() for s in settings.social_links.split(",") if s.strip()],
        analytics_id=settings.analytics_id,
        gtm_container_id=settings.gtm_container_id,
        # One of the TWO DB reads on this endpoint (the other is `theme`).
        # Identity must survive a DB outage exactly as it survives an
        # unreachable backend on the client side — degrade to the default,
        # never 500 the public site's bootstrap (#295 review: this endpoint
        # was DB-free before availability).
        availability=await read_availability_or_default(db),
        ai_crawler_policy=settings.ai_crawler_policy,
        # Second DB read, same degrade-never-break contract as availability
        # above: a DB outage must cost the site its THEME, not its bootstrap.
        theme=await read_theme_or_default(db),
    )
