import httpx
from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import Response
from sqlalchemy import select
from sqlalchemy.exc import ProgrammingError
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.site_settings import read_availability_or_default
from app.config import settings
from app.database import get_db
from app.logger import logger
from app.models.profile_photo import ProfilePhoto
from app.models.profile_snapshot import ProfileSnapshot
from app.services.json_resume import JsonResume, ResumeContext, build_json_resume
from app.services.rate_limit import SlidingWindowRateLimiter, rate_limit_dependency
from app.services.readiness import is_undefined_table_error

router = APIRouter(prefix="/profile", tags=["profile"])

# Public, unauthenticated GETs on this router are rate-limited per client IP
# (defense-in-depth against scraping/abuse) — see `app.services.rate_limit`.
profile_rate_limiter = SlidingWindowRateLimiter(
    max_requests=settings.profile_rate_limit_requests,
    window_seconds=settings.profile_rate_limit_window_seconds,
)
_enforce_rate_limit = rate_limit_dependency(profile_rate_limiter)

# Languages the site serves. Keep in sync with the frontend LanguageService.
SUPPORTED_LANGUAGES = ("en", "de")

# Only these top-level fields are exposed publicly. The raw uploaded scraper JSON
# is stored as-is but NEVER served as-is: a LinkedIn export can carry non-public
# PII (phone, address, birthday, connections, contactInfo). Serving through this
# allowlist guarantees only portfolio-safe fields reach unauthenticated callers.
PUBLIC_PROFILE_FIELDS = frozenset(
    {
        "name",
        "headline",
        "location",
        "about",
        "experience",
        "education",
        "skills",
        "certifications",
        "languages",
        "recommendations",
        "projects",
    }
)
# Within `contact`, only these are public (email + linkedin are shown on the site).
PUBLIC_CONTACT_FIELDS = frozenset({"email", "linkedin"})

# Within each `projects` entry, only these keys are public (#92). `experience`
# and `education` pass their nested keys through because their shape comes from
# the LinkedIn scraper and is known; a `projects` array is HAND-AUTHORED — a
# forker pastes it from their own notes — so a stored
# `{"title": "...", "clientContact": "..."}` would otherwise be served verbatim
# to unauthenticated callers. The public site renders exactly these keys, so
# anything else on the wire has no consumer and is pure attack surface.
PUBLIC_PROJECT_FIELDS = frozenset(
    {
        "title",
        "slug",
        "summary",
        "description",
        "role",
        "startDate",
        "endDate",
        "techStack",
        "links",
        "image",
    }
)
# Within a project's `links`, only these are public.
PUBLIC_PROJECT_LINK_FIELDS = frozenset({"source", "demo"})


# Sections rendered as a dated timeline. A LinkedIn scrape carries NO ordering
# guarantee — the stored array is whatever order the export happened to emit, and
# on a real deployment that surfaced as a thirteen-year-old role leading the
# career section while the CURRENT, still-ongoing role sat eighth. Ordering here
# rather than in the Angular component fixes the site and the JSON Resume / CV
# export together, because both read this one projection.
TIMELINE_FIELDS = ("experience", "education")

_MONTHS = {
    "jan": 1,
    "feb": 2,
    "mar": 3,
    "apr": 4,
    "may": 5,
    "jun": 6,
    "jul": 7,
    "aug": 8,
    "sep": 9,
    "oct": 10,
    "nov": 11,
    "dec": 12,
}
# Only an EXPLICIT marker counts as ongoing. A merely missing end date is
# ambiguous — treating it as "now" would float an undated entry to the top.
_ONGOING = frozenset({"present", "current", "now", "heute", "aktuell"})
# Sorts above every real date, so an ongoing role leads the list.
_ONGOING_KEY = (9999, 12)
# Sorts below every real date, so an unparseable entry sinks instead of leading.
_UNDATED_KEY = (0, 0)


def _month_year(value: object) -> tuple[int, int] | None:
    """``"Mar 2025"`` -> ``(2025, 3)``; ``"1986"`` -> ``(1986, 0)``; else ``None``."""
    if not isinstance(value, str):
        return None
    parts = value.strip().split()
    if len(parts) == 2 and parts[1].isdigit():
        month = _MONTHS.get(parts[0][:3].lower())
        if month is not None:
            return (int(parts[1]), month)
    if len(parts) == 1 and parts[0].isdigit() and len(parts[0]) == 4:
        return (int(parts[0]), 0)
    return None


def _timeline_sort_key(entry: object) -> tuple[int, int, int, int]:
    """Reverse-chronological key: ongoing first, then by end date, then start."""
    if not isinstance(entry, dict):
        return (*_UNDATED_KEY, *_UNDATED_KEY)
    start = _month_year(entry.get("startDate")) or _UNDATED_KEY
    raw_end = entry.get("endDate")
    if isinstance(raw_end, str) and raw_end.strip().lower() in _ONGOING:
        end = _ONGOING_KEY
    else:
        # No parseable end: fall back to the start so a still-dated entry is
        # placed by when it began rather than dumped at the bottom.
        end = _month_year(raw_end) or start
    return (*end, *start)


def _sorted_timeline(entries: object) -> object:
    """Order a timeline section newest-first, leaving anything else untouched."""
    if not isinstance(entries, list):
        return entries
    # `sorted` is stable, so entries sharing an end AND start date keep the
    # relative order the source gave them — a contractor role and the agency
    # that placed it routinely carry identical dates.
    return sorted(entries, key=_timeline_sort_key, reverse=True)


def _public_projects(entries: object) -> object:
    """Project each `projects` entry down to the nested allowlist.

    A non-dict entry is left untouched: it carries no hidden keys to strip, and
    the frontend drops it anyway. Anything that is not a list is returned as-is
    so a malformed upload fails visibly at the renderer rather than silently
    becoming an empty section here.
    """
    if not isinstance(entries, list):
        return entries
    projected: list = []
    for entry in entries:
        if not isinstance(entry, dict):
            projected.append(entry)
            continue
        # `links` is EXCLUDED here and re-added below, never inherited. It is
        # itself in PUBLIC_PROJECT_FIELDS, so admitting it in the comprehension
        # copies the value verbatim and the nested projection — which only fires
        # for a dict — never sees a list or a scalar. A hand-authored
        # `"links": [{"internalTracker": ...}]` then reached the public wire
        # unstripped (PR #451 review round 1, blocker 4). Only the documented
        # object shape is servable; anything else has no renderer and is dropped.
        item = {
            k: v
            for k, v in entry.items()
            if k in PUBLIC_PROJECT_FIELDS and k != "links"
        }
        links = entry.get("links")
        if isinstance(links, dict):
            item["links"] = {
                k: v for k, v in links.items() if k in PUBLIC_PROJECT_LINK_FIELDS
            }
        projected.append(item)
    return projected


def public_profile_view(data: object) -> dict:
    """Project stored profile data down to the public allowlist."""
    if not isinstance(data, dict):
        return {}
    view: dict = {k: v for k, v in data.items() if k in PUBLIC_PROFILE_FIELDS}
    for field in TIMELINE_FIELDS:
        if field in view:
            view[field] = _sorted_timeline(view[field])
    if "projects" in view:
        view["projects"] = _public_projects(view["projects"])
    contact = data.get("contact")
    if isinstance(contact, dict):
        view["contact"] = {
            k: v for k, v in contact.items() if k in PUBLIC_CONTACT_FIELDS
        }
    return view


def _validated_language(lang: str) -> str:
    language = lang.lower()
    if language not in SUPPORTED_LANGUAGES:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported language '{lang}'. Supported: {', '.join(SUPPORTED_LANGUAGES)}.",
        )
    return language


async def _active_snapshot(db: AsyncSession, language: str) -> ProfileSnapshot | None:
    """The active snapshot for ``language``, or ``None`` if nothing is activated."""
    try:
        result = await db.execute(
            select(ProfileSnapshot).where(
                ProfileSnapshot.is_active.is_(True),
                ProfileSnapshot.language == language,
            )
        )
    except ProgrammingError as exc:
        # Startup race (#124): the entrypoint's `alembic upgrade head` has not
        # created `profile_snapshots` yet. Return a graceful, retryable 503
        # instead of leaking a raw 500 UndefinedTableError during warm-up.
        if is_undefined_table_error(exc):
            logger.warning(
                "profile_snapshots not yet migrated (startup warm-up, #124): %s", exc
            )
            raise HTTPException(
                status_code=503,
                detail="Service is starting up, please retry shortly.",
            ) from exc
        raise
    return result.scalar_one_or_none()


@router.get("", dependencies=[Depends(_enforce_rate_limit)])
async def get_active_profile(
    lang: str = Query("en", description="Profile language (en|de)"),
    db: AsyncSession = Depends(get_db),
):
    """Return the raw ``data`` of the active profile for ``lang``.

    404 when no version has been uploaded/activated for that language yet — the
    frontend falls back to its bundled static asset in that case, so the site is
    never blank before the first upload.
    """
    language = _validated_language(lang)
    profile = await _active_snapshot(db, language)
    if profile is None:
        logger.info("No active profile for language=%s", language)
        raise HTTPException(
            status_code=404, detail=f"No active profile for language '{language}'."
        )
    # Never serve the raw uploaded blob — project to the public allowlist so an
    # uploaded scraper JSON cannot leak non-public PII.
    return public_profile_view(profile.data)


@router.get("/photo", dependencies=[Depends(_enforce_rate_limit)])
async def get_profile_photo(db: AsyncSession = Depends(get_db)):
    """The uploaded portrait (#333); 404 when none has been uploaded.

    The hero renders this URL directly in an ``<img>`` and falls back to its
    baked placeholder on error, so a fresh fork looks exactly as before the
    first upload. Short public cache: the photo changes rarely, but a
    replacement should show up without a hard refresh ritual.
    """
    result = await db.execute(
        select(ProfilePhoto).order_by(ProfilePhoto.updated_at.desc()).limit(1)
    )
    photo = result.scalar_one_or_none()
    if photo is None:
        # no-store: a cached 404 would hide a first upload for max-age.
        raise HTTPException(
            status_code=404,
            detail="No profile photo uploaded.",
            headers={"Cache-Control": "no-store"},
        )
    return Response(
        content=photo.data,
        media_type=photo.content_type,
        headers={"Cache-Control": "public, max-age=300"},
    )


async def _bundled_profile(language: str) -> dict | None:
    """The frontend's bundled demo profile, read over the compose network.

    The public site falls back to `assets/profile_data_<lang>.json` when no
    snapshot has been activated (`ProfileService.getProfile`), so on a fresh
    stack that asset IS the rendered profile. The machine-readable projection
    has to agree with the HTML — an agent-facing document that 404s while the
    page shows a full CV is worse than no document at all. Same source and the
    same settings the years API already reads it with
    (`app/api/years.py`, #252 review of the fresh-stack path).
    """
    url = f"{settings.profile_data_http_base}/profile_data_{language}.json"
    try:
        async with httpx.AsyncClient(
            timeout=settings.profile_data_timeout_seconds
        ) as client:
            response = await client.get(url)
            response.raise_for_status()
            data = response.json()
    except Exception as exc:
        logger.warning("Could not fetch bundled profile data from %s: %s", url, exc)
        return None
    return data if isinstance(data, dict) else None


@router.get(
    "/resume.json",
    response_model=JsonResume,
    response_model_exclude_none=True,
    dependencies=[Depends(_enforce_rate_limit)],
)
async def get_resume(
    lang: str = Query("en", description="Profile language (en|de)"),
    db: AsyncSession = Depends(get_db),
) -> JsonResume:
    """The public profile as a **JSON Resume** v1.0.0 document (#252).

    The single request an AI agent needs to rank this candidate: identity,
    experience, education, skills, languages, certificates and references in the
    schema the ecosystem already parses, plus the availability signal and
    contact route in ``meta``. Built from the SAME public allowlist the HTML
    profile uses, so it can never expose a field the site does not already show.
    """
    language = _validated_language(lang)
    snapshot = await _active_snapshot(db, language)
    if snapshot is not None:
        data: object | None = snapshot.data
        profile_version: str | None = snapshot.version
        last_modified = snapshot.created_at.isoformat() if snapshot.created_at else None
    else:
        data = await _bundled_profile(language)
        profile_version = None
        last_modified = None
        if data is None:
            logger.info("No profile available for resume.json (language=%s)", language)
            raise HTTPException(
                status_code=404,
                detail=f"No profile available for language '{language}'.",
            )

    site_url = settings.site_url.rstrip("/")
    context = ResumeContext(
        site_url=site_url,
        social_links=[s.strip() for s in settings.social_links.split(",") if s.strip()],
        availability=await read_availability_or_default(db),
        language=language,
        profile_version=profile_version,
        last_modified=last_modified,
        canonical_url=f"{site_url}{settings.api_prefix}/profile/resume.json",
    )
    return build_json_resume(public_profile_view(data), context)
