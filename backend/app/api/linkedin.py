import json
import logging
import re
import secrets
from datetime import datetime
from urllib.parse import urlparse

import httpx
from fastapi import (
    APIRouter,
    Depends,
    File,
    Form,
    Header,
    HTTPException,
    UploadFile,
    status,
)
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.database import get_db
from app.logger import log_safe
from app.models.post import Post
from app.models.user import User
from app.services.auth import get_current_admin_user, get_current_user_optional
from app.services.embeddings import get_embedding
from app.services.linkedin import (
    extract_hashtags,
    linkedin_service,
    normalize_linkedin_text,
)
from app.services.post_metadata import (
    DEFAULT_TITLE,
    derive_summary,
    derive_title,
    is_machine_summary,
    is_machine_title,
    legacy_derive_summary,
    legacy_derive_title,
)
from app.services.slugs import slug_suffix

ALLOWED_IMAGE_TYPES = {"image/jpeg", "image/png", "image/webp", "image/gif"}

# Post images may only be fetched from LinkedIn's CDN. This is a hard SSRF guard
# AND the reason it is safe to attach the `li_at` session cookie to the request:
# the cookie is never sent anywhere but LinkedIn.
ALLOWED_IMAGE_HOSTS = ("licdn.com",)

# Bounds for the bulk posts-JSON import (resource-exhaustion guards). Both are
# read from settings at call time — like ``import_max_image_mb`` next door — so
# an operator can raise or lower them from .env without a rebuild (#207).

router = APIRouter(prefix="/linkedin", tags=["linkedin"])
logger = logging.getLogger(__name__)


class LinkedInLoginRequest(BaseModel):
    username: str
    password: str


@router.post("/login")
async def login_linkedin(
    login_data: LinkedInLoginRequest,
    current_user: User = Depends(get_current_admin_user),
):
    """
    Dynamically authenticates with LinkedIn and saves session cookies to the server.
    """
    logger.info(f"[LinkedIn] Dynamic login requested by user: {current_user.username}")
    try:
        success = await linkedin_service.login(login_data.username, login_data.password)
        if success:
            return {"message": "Successfully logged in and saved session."}
        else:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Login failed. Check credentials and MFA.",
            )
    except HTTPException:
        raise
    except Exception:
        logger.exception("[LinkedIn] Dynamic login FAILED")
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="LinkedIn login failed. Check credentials and MFA.",
        )


@router.get("/status")
async def get_linkedin_status(
    current_user: User = Depends(get_current_admin_user),
):
    """
    Checks if there is an active valid LinkedIn session available.
    """
    is_logged_in = await linkedin_service.is_logged_in()
    message = (
        "LinkedIn session is active."
        if is_logged_in
        else "No active LinkedIn session. Use 'Log in & save session' to authenticate."
    )
    return {"logged_in": is_logged_in, "message": message}


@router.get("/profile-sync")
async def sync_linkedin_profile(
    current_user: User = Depends(get_current_admin_user),
):
    """
    Fetches the LinkedIn profile data via the Python `linkedin-api` HTTP client.
    """
    logger.info(
        "[LinkedIn] profile-sync requested by user=%s | creds_configured: email=%s, public_id=%s",
        current_user.username,
        bool(settings.linkedin_email),
        bool(settings.linkedin_public_id),
    )
    try:
        profile_data = await linkedin_service.sync_profile()
        logger.info(
            "[LinkedIn] profile-sync SUCCESS: returned %d fields",
            len(profile_data) if isinstance(profile_data, dict) else 0,
        )
        return profile_data
    except ValueError:
        logger.exception("[LinkedIn] profile-sync CONFIG ERROR")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="LinkedIn config error.",
        )
    except Exception:
        logger.exception("[LinkedIn] profile-sync FAILED")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="LinkedIn profile sync failed.",
        )


@router.get("/posts")
async def get_linkedin_posts(
    current_user: User = Depends(get_current_admin_user),
):
    """
    Fetches recent LinkedIn posts via the Python `linkedin-api` HTTP client.
    """
    logger.info(
        "[LinkedIn] /posts requested by user=%s | creds_configured: email=%s, public_id=%s",
        current_user.username,
        bool(settings.linkedin_email),
        bool(settings.linkedin_public_id),
    )
    try:
        posts = await linkedin_service.fetch_posts()
        posts_with_images = sum(1 for p in posts if p.get("image_url"))
        logger.info(
            "[LinkedIn] /posts SUCCESS: %d posts fetched (%d with images)",
            len(posts),
            posts_with_images,
        )
        return posts
    except ValueError as e:
        logger.warning("[LinkedIn] /posts NOT CONFIGURED: %s", e)
        return []
    except Exception:
        logger.exception("[LinkedIn] /posts FAILED")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="LinkedIn posts fetch failed.",
        )


class TransferPostRequest(BaseModel):
    content: str
    image_url: str | None = None
    urn: str | None = None


async def _create_post_from_transfer(post_data: TransferPostRequest) -> Post:
    """Shared helper to create a Post from a TransferPostRequest."""
    title = derive_title(post_data.content)

    slug_base = re.sub(r"[^a-z0-9]+", "-", title.lower()).strip("-")
    if not slug_base:
        slug_base = "linkedin-post"
    slug = f"{slug_base}-{slug_suffix()}"

    text_for_embedding = f"{title}\n\n{post_data.content}"
    embedding = await get_embedding(text_for_embedding)

    logger.debug(
        "[LinkedIn] _create_post: title=%r, slug=%s, image_url=%s, content_len=%d",
        title,
        slug,
        post_data.image_url or "none",
        len(post_data.content),
    )

    return Post(
        title=title,
        slug=slug,
        content=post_data.content,
        summary=derive_summary(post_data.content) or None,
        image_url=post_data.image_url,
        language="en",
        published=False,
        tags=["LinkedIn"],
        embedding=embedding,
    )


@router.post("/transfer-post")
async def transfer_linkedin_post(
    post_data: TransferPostRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_admin_user),
):
    """
    Transfers a single scraped LinkedIn post into the local database as a draft.
    """
    logger.info(
        "[LinkedIn] transfer-post: user=%s, content_len=%d, has_image=%s, urn=%s",
        log_safe(current_user.username),
        len(post_data.content),
        bool(post_data.image_url),
        log_safe(post_data.urn or "none"),
    )
    try:
        post = await _create_post_from_transfer(post_data)
        db.add(post)
        await db.commit()
        await db.refresh(post)
        logger.info(
            "[LinkedIn] transfer-post SUCCESS: id=%s, title=%r", post.id, post.title
        )
        return {"id": post.id, "message": "Post transferred successfully"}
    except Exception:
        await db.rollback()
        logger.exception("[LinkedIn] transfer-post FAILED")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Transfer failed.",
        )


@router.post("/transfer-posts")
async def transfer_linkedin_posts(
    posts_data: list[TransferPostRequest],
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_admin_user),
):
    """
    Transfers multiple LinkedIn posts into the local database as drafts.
    """
    logger.info(
        "[LinkedIn] transfer-posts BULK: user=%s, count=%d",
        current_user.username,
        len(posts_data),
    )
    transferred = []
    try:
        for i, post_data in enumerate(posts_data):
            logger.info(
                "[LinkedIn] transfer-posts [%d/%d]: content_len=%d, has_image=%s",
                i + 1,
                len(posts_data),
                len(post_data.content),
                bool(post_data.image_url),
            )
            post = await _create_post_from_transfer(post_data)
            db.add(post)
            transferred.append(post)
        await db.commit()
        for post in transferred:
            await db.refresh(post)
        logger.info(
            "[LinkedIn] transfer-posts SUCCESS: %d posts transferred, ids=%s",
            len(transferred),
            [p.id for p in transferred],
        )
        return {
            "transferred": len(transferred),
            "ids": [p.id for p in transferred],
            "message": f"Successfully transferred {len(transferred)} posts",
        }
    except Exception:
        await db.rollback()
        logger.exception(
            "[LinkedIn] transfer-posts FAILED at post %d", len(transferred) + 1
        )
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Bulk transfer failed.",
        )


# --- Import a single LinkedIn post (text + optional image bytes) -------------


def _import_authorized(token: str | None, user: User | None) -> bool:
    """Authorize an import: a valid machine token (constant-time compare) OR an
    admin JWT. A blank/unset configured token never authenticates."""
    configured = settings.linkedin_import_token
    if configured and token and secrets.compare_digest(token, configured):
        return True
    return bool(user and getattr(user, "is_admin", False))


def _slug_base(title: str) -> str:
    base = re.sub(r"[^a-z0-9]+", "-", title.lower()).strip("-")
    return base or "linkedin-post"


def _parse_posted_at(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        return datetime.fromisoformat(value)
    except ValueError:
        return None


def _resolve_tags(raw_tags: str | None, content: str) -> list[str]:
    """Explicit CSV tags if given, else hashtags from the content; always keep a
    'LinkedIn' base tag; de-duplicate case-insensitively; cap at 5."""
    if raw_tags:
        candidates = [t.strip() for t in raw_tags.split(",") if t.strip()]
    else:
        candidates = extract_hashtags(content)
    result: list[str] = []
    seen: set[str] = set()
    for tag in ["LinkedIn", *candidates]:
        key = tag.lower()
        if key not in seen:
            seen.add(key)
            result.append(tag)
        if len(result) == 5:
            break
    return result


async def _upsert_linkedin_post(
    db: AsyncSession,
    *,
    urn: str,
    title: str,
    summary: str,
    content: str,
    language: str,
    published: bool,
    tags: list[str],
    source_url: str | None,
    posted_at: datetime | None,
    embedding,
    image_bytes: bytes | None,
    image_type: str | None,
    title_explicit: bool = False,
    summary_explicit: bool = False,
) -> tuple[Post, bool]:
    """Upsert a post by LinkedIn URN. Returns (post, created).

    On UPDATE, a derived title/summary replaces the stored one only while the
    stored value is still machine output for the stored body
    (``is_machine_title``/``is_machine_summary``) — a value a human edited in
    the admin survives every re-import. A value the CALLER passed explicitly
    is a deliberate act and always applies. Derivation is deterministic, so
    re-importing an unchanged post never flaps either field.
    """
    existing = (
        await db.execute(select(Post).where(Post.source_urn == urn))
    ).scalar_one_or_none()

    if existing is not None:
        # Both checks read the body BEFORE it is overwritten: "machine output"
        # means machine output for the content it was derived from.
        if title_explicit or is_machine_title(existing.title, existing.content):
            existing.title = title
        if summary_explicit or is_machine_summary(existing.summary, existing.content):
            existing.summary = summary
        existing.content = content
        existing.posted_at = posted_at or existing.posted_at
        existing.source_url = source_url or existing.source_url
        existing.embedding = embedding
        if image_bytes is not None:
            existing.image_blob = image_bytes
            existing.image_type = image_type
            existing.image_url = None
        await db.commit()
        await db.refresh(existing)
        return existing, False

    post = Post(
        title=title,
        slug=f"{_slug_base(title)}-{slug_suffix()}",
        content=content,
        summary=summary,
        language=language,
        published=published,
        tags=tags,
        embedding=embedding,
        source_urn=urn,
        source_url=source_url,
        posted_at=posted_at,
        image_blob=image_bytes,
        image_type=image_type,
    )
    try:
        db.add(post)
        await db.commit()
    except Exception:
        # Slug collision on (slug, language) — retry once with a fresh suffix.
        await db.rollback()
        post.slug = f"{_slug_base(title)}-{slug_suffix()}"
        db.add(post)
        await db.commit()
    await db.refresh(post)
    return post, True


@router.post("/import-post")
async def import_linkedin_post(
    content: str = Form(...),
    urn: str = Form(...),
    title: str | None = Form(None),
    summary: str | None = Form(None),
    language: str = Form("en"),
    posted_at: str | None = Form(None),
    source_url: str | None = Form(None),
    tags: str | None = Form(None),
    published: bool = Form(False),
    image: UploadFile | None = File(None),
    x_import_token: str | None = Header(None, alias="X-Import-Token"),
    db: AsyncSession = Depends(get_db),
    current_user: User | None = Depends(get_current_user_optional),
):
    """Ingest one LinkedIn post — text (+ optional image bytes) — storing the image
    locally and upserting by its LinkedIn URN so re-imports never duplicate.

    Auth: `X-Import-Token` header (machine) or an admin JWT. Imported posts are
    drafts (`published=false`) unless explicitly published on first import.
    """
    if not _import_authorized(x_import_token, current_user):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Import requires a valid X-Import-Token or an admin session.",
        )

    image_bytes: bytes | None = None
    image_type: str | None = None
    if image is not None:
        if image.content_type not in ALLOWED_IMAGE_TYPES:
            raise HTTPException(
                status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
                detail=f"Unsupported image type: {image.content_type}. "
                f"Allowed: {', '.join(sorted(ALLOWED_IMAGE_TYPES))}.",
            )
        image_bytes = await image.read()
        max_bytes = settings.import_max_image_mb * 1024 * 1024
        if len(image_bytes) > max_bytes:
            raise HTTPException(
                status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                detail=f"Image exceeds {settings.import_max_image_mb} MB limit.",
            )
        image_type = image.content_type

    clean_content = normalize_linkedin_text(content)
    explicit_title = (title or "").strip()
    explicit_summary = (summary or "").strip()
    resolved_title = explicit_title or derive_title(clean_content)
    resolved_summary = explicit_summary or derive_summary(clean_content)
    embedding = await get_embedding(f"{resolved_title}\n\n{clean_content}")

    logger.info(
        "[LinkedIn] import-post: urn=%s, has_image=%s, content_len=%d, lang=%s",
        log_safe(urn),
        image_bytes is not None,
        len(clean_content),
        log_safe(language),
    )

    post, created = await _upsert_linkedin_post(
        db,
        urn=urn,
        title=resolved_title,
        summary=resolved_summary,
        content=clean_content,
        language=language,
        published=published,
        tags=_resolve_tags(tags, clean_content),
        source_url=source_url,
        posted_at=_parse_posted_at(posted_at),
        embedding=embedding,
        image_bytes=image_bytes,
        image_type=image_type,
        title_explicit=bool(explicit_title),
        summary_explicit=bool(explicit_summary),
    )
    return {
        "id": post.id,
        "slug": post.slug,
        "created": created,
        "message": (
            "Post imported from LinkedIn as a draft."
            if created
            else "Post updated from LinkedIn (matched by URN)."
        ),
    }


# --- Bulk import from a scraper posts_data.json file -------------------------


def _pick_image_url(entry: dict) -> str | None:
    """Return the best image URL from a scraper post entry, if any."""
    url = entry.get("imageUrl")
    if url:
        return url
    images = entry.get("imageUrls") or []
    return images[0] if images else None


def _safe_http_url(url: object) -> str | None:
    """Keep a URL only if it is a real http(s) URL.

    Stored post URLs (`source_url`, fallback `image_url`) come from the uploaded
    JSON and are rendered by the site — reject `javascript:`/`data:`/other
    schemes so nothing dangerous is persisted.
    """
    if not isinstance(url, str) or not url:
        return None
    try:
        scheme = urlparse(url).scheme.lower()
    except (ValueError, TypeError, AttributeError):
        return None
    return url if scheme in ("http", "https") else None


def _is_allowed_image_url(url: str) -> bool:
    """Only https URLs on LinkedIn's CDN are eligible for server-side download.

    Prevents SSRF (no fetching internal/metadata endpoints) and protects the
    ``li_at`` cookie from leaking to attacker-controlled hosts supplied in the
    uploaded JSON.
    """
    try:
        parsed = urlparse(url)
        if parsed.scheme != "https":
            return False
        # .hostname raises ValueError on malformed authorities (bad IPv6/port).
        host = (parsed.hostname or "").lower()
    except (ValueError, TypeError, AttributeError):
        # AttributeError: a non-str url (e.g. a numeric imageUrl) reached here.
        return False
    return any(host == h or host.endswith("." + h) for h in ALLOWED_IMAGE_HOSTS)


async def _download_image_best_effort(
    url: str | None,
) -> tuple[bytes | None, str | None]:
    """Best-effort fetch of a post image from LinkedIn's CDN using the ``li_at``
    cookie.

    Returns ``(bytes, content_type)`` on success, or ``(None, None)`` on any
    failure (disallowed/None URL, network error, unsupported type, too large) —
    the caller then falls back to storing the remote URL, so a single bad image
    never fails the whole import.

    Security: the URL must pass :func:`_is_allowed_image_url` (https + LinkedIn
    CDN host) before any request is made, redirects are NOT followed (a redirect
    could escape the allowlist), and the body is size-capped by the declared
    Content-Length before it is read into memory.
    """
    if not url or not _is_allowed_image_url(url):
        return None, None
    cookies = (
        {"li_at": settings.linkedin_cookie_li_at}
        if settings.linkedin_cookie_li_at
        else None
    )
    max_bytes = settings.import_max_image_mb * 1024 * 1024
    try:
        async with httpx.AsyncClient(timeout=10, follow_redirects=False) as http:
            resp = await http.get(url, cookies=cookies)
        resp.raise_for_status()
        content_type = (resp.headers.get("content-type") or "").split(";")[0].strip()
        if content_type not in ALLOWED_IMAGE_TYPES:
            return None, None
        declared = resp.headers.get("content-length")
        if declared and declared.isdigit() and int(declared) > max_bytes:
            return None, None
        data = resp.content
        if len(data) > max_bytes:
            return None, None
        return data, content_type
    except Exception as e:  # best-effort, never fatal (see BLE001 ignore rationale)
        logger.warning("[LinkedIn] image download failed for %s: %s", url, e)
        return None, None


@router.post("/import-posts-json")
async def import_posts_json(
    file: UploadFile = File(...),
    x_import_token: str | None = Header(None, alias="X-Import-Token"),
    db: AsyncSession = Depends(get_db),
    current_user: User | None = Depends(get_current_user_optional),
):
    """Bulk-import a scraper ``posts_data.json`` array as drafts.

    Each entry is upserted by its LinkedIn URN (idempotent — re-uploading never
    duplicates). Images are downloaded best-effort; on failure the remote URL is
    kept instead. Entries without a URN or content are skipped. Auth mirrors
    ``/import-post`` (machine token or admin session).
    """
    if not _import_authorized(x_import_token, current_user):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Import requires a valid X-Import-Token or an admin session.",
        )

    # Cap the in-memory read so an oversized upload can't exhaust memory.
    max_json_bytes = settings.import_max_posts_json_mb * 1024 * 1024
    raw = await file.read(max_json_bytes + 1)
    if len(raw) > max_json_bytes:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail=(
                f"Posts JSON exceeds {settings.import_max_posts_json_mb} MB limit."
            ),
        )
    try:
        entries = json.loads(raw)
    except (json.JSONDecodeError, UnicodeDecodeError):
        raise HTTPException(status_code=400, detail="File is not valid JSON.")
    if not isinstance(entries, list):
        raise HTTPException(
            status_code=400, detail="Posts JSON must be a top-level array."
        )

    total_entries = len(entries)
    max_entries = settings.import_max_posts_per_request
    if total_entries > max_entries:
        logger.warning(
            "[LinkedIn] import-posts-json: %d entries exceeds cap %d — processing "
            "the first %d only.",
            total_entries,
            max_entries,
            max_entries,
        )
        entries = entries[:max_entries]

    created = 0
    updated = 0
    skipped = 0
    for entry in entries:
        if not isinstance(entry, dict):
            skipped += 1
            continue
        urn = (entry.get("urn") or "").strip()
        content = normalize_linkedin_text(entry.get("content") or "")
        if not urn or not content:
            skipped += 1
            continue

        image_url = _pick_image_url(entry)
        image_bytes, image_type = await _download_image_best_effort(image_url)

        title = derive_title(content)
        embedding = await get_embedding(f"{title}\n\n{content}")

        post, was_created = await _upsert_linkedin_post(
            db,
            urn=urn,
            title=title,
            summary=derive_summary(content),
            content=content,
            language=(entry.get("language") or "en").lower()[:2],
            published=False,
            tags=_resolve_tags(None, content),
            source_url=_safe_http_url(entry.get("url")),
            posted_at=_parse_posted_at(entry.get("postedAt")),
            embedding=embedding,
            image_bytes=image_bytes,
            image_type=image_type,
        )
        # Keep the remote URL when we could not download the image locally —
        # only if it is a safe http(s) URL.
        safe_image_url = _safe_http_url(image_url)
        if image_bytes is None and safe_image_url and post.image_url != safe_image_url:
            post.image_url = safe_image_url
            await db.commit()
        if was_created:
            created += 1
        else:
            updated += 1

    logger.info(
        "[LinkedIn] import-posts-json: created=%d updated=%d skipped=%d (of %d)",
        created,
        updated,
        skipped,
        len(entries),
    )
    return {
        "created": created,
        "updated": updated,
        "skipped": skipped,
        "count": len(entries),
    }


# --- Re-derive title/summary of already-imported posts ------------------------


class FieldChange(BaseModel):
    old: str | None
    new: str


class RederiveItem(BaseModel):
    id: int
    slug: str
    title: FieldChange | None = None
    summary: FieldChange | None = None


class RederiveResult(BaseModel):
    dry_run: bool
    # Imported posts examined (those carrying a LinkedIn URN).
    scanned: int
    # Posts with at least one field that would change (dry run) / did change.
    changed: int
    # Fields left alone because they no longer equal the previous derivation,
    # i.e. a human edited them.
    kept_human_title: int
    kept_human_summary: int
    # Fields left alone because the new derivation could only offer its
    # fallback (DEFAULT_TITLE / an empty summary) where the row holds real
    # text: a re-derive must never replace a title with the fallback.
    kept_over_fallback_title: int
    kept_over_empty_summary: int
    items: list[RederiveItem]


@router.post("/rederive-metadata", response_model=RederiveResult)
async def rederive_metadata(
    dry_run: bool = True,
    x_import_token: str | None = Header(None, alias="X-Import-Token"),
    db: AsyncSession = Depends(get_db),
    current_user: User | None = Depends(get_current_user_optional),
) -> RederiveResult:
    """Recompute the derived title/summary of imported posts — a DRY RUN by
    default; ``?dry_run=false`` applies.

    Existing rows keep whatever the import that created them derived; this is
    the owner's deliberate, reviewable way to move them onto the current
    derivation (no migration rewrites production rows). A field changes ONLY
    while it still equals the PREVIOUS derivation of the stored body
    (``legacy_derive_title``/``legacy_derive_summary``) or is empty, so
    anything a human edited is counted and left alone. Nor does a field change
    when the new derivation has nothing better than its fallback
    (``DEFAULT_TITLE``, an empty summary) and the row holds real text — that
    would be a regression, so it is counted and left alone. Slugs are never
    touched — they are published URLs. Idempotent: a second apply changes
    nothing. Auth mirrors ``/import-post`` (machine token or admin session).
    """
    if not _import_authorized(x_import_token, current_user):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Re-derive requires a valid X-Import-Token or an admin session.",
        )

    result = await db.execute(
        select(Post).where(Post.source_urn.isnot(None)).order_by(Post.id)
    )
    posts = result.scalars().all()
    items: list[RederiveItem] = []
    kept_title = 0
    kept_summary = 0
    kept_fallback_title = 0
    kept_empty_summary = 0
    for post in posts:
        item = RederiveItem(id=post.id, slug=post.slug)
        new_title = derive_title(post.content)
        if post.title != new_title:
            if post.title and new_title == DEFAULT_TITLE:
                kept_fallback_title += 1
            elif not post.title or post.title == legacy_derive_title(post.content):
                item.title = FieldChange(old=post.title, new=new_title)
            else:
                kept_title += 1
        new_summary = derive_summary(post.content)
        if (post.summary or "") != new_summary:
            # Only reachable with a non-empty stored summary (they differ).
            if not new_summary:
                kept_empty_summary += 1
            elif not post.summary or post.summary == legacy_derive_summary(
                post.content
            ):
                item.summary = FieldChange(old=post.summary, new=new_summary)
            else:
                kept_summary += 1
        if item.title is None and item.summary is None:
            continue
        items.append(item)
        if not dry_run:
            if item.title is not None:
                post.title = item.title.new
            if item.summary is not None:
                post.summary = item.summary.new

    if not dry_run and items:
        await db.commit()

    logger.info(
        "[LinkedIn] rederive-metadata: dry_run=%s scanned=%d changed=%d "
        "kept_human_title=%d kept_human_summary=%d "
        "kept_over_fallback_title=%d kept_over_empty_summary=%d",
        dry_run,
        len(posts),
        len(items),
        kept_title,
        kept_summary,
        kept_fallback_title,
        kept_empty_summary,
    )
    return RederiveResult(
        dry_run=dry_run,
        scanned=len(posts),
        changed=len(items),
        kept_human_title=kept_title,
        kept_human_summary=kept_summary,
        kept_over_fallback_title=kept_fallback_title,
        kept_over_empty_summary=kept_empty_summary,
        items=items,
    )
