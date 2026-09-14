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


def public_profile_view(data: object) -> dict:
    """Project stored profile data down to the public allowlist."""
    if not isinstance(data, dict):
        return {}
    view: dict = {k: v for k, v in data.items() if k in PUBLIC_PROFILE_FIELDS}
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
        raise HTTPException(status_code=404, detail="No profile photo uploaded.")
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
