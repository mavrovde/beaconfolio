import json
import uuid
from math import ceil

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile
from sqlalchemy import delete, func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.logger import logger
from app.models.profile_photo import ProfilePhoto
from app.models.profile_snapshot import ProfileSnapshot
from app.models.user import User
from app.services.auth import get_current_admin_user

router = APIRouter(prefix="/admin/profile", tags=["admin-profile"])

SUPPORTED_LANGUAGES = ("en", "de")

# Bound the uploaded profile JSON so even an authenticated admin (or a stolen
# admin token) can't exhaust memory with a huge body.
MAX_PROFILE_JSON_BYTES = 5 * 1024 * 1024  # 5 MB

# Only these columns may drive ORDER BY (prevents an uncaught 500 from a
# non-orderable class attribute reaching order_by).
SORTABLE_COLUMNS = frozenset({"created_at", "version", "language", "is_active"})


def _validate_language(language: str) -> str:
    lang = (language or "").lower()
    if lang not in SUPPORTED_LANGUAGES:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported language '{language}'. Supported: {', '.join(SUPPORTED_LANGUAGES)}.",
        )
    return lang


@router.post("/upload")
async def upload_profile(
    file: UploadFile = File(...),
    version: str = Form(...),
    language: str = Form("en"),
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(get_current_admin_user),
):
    """Upload a scraper ``profile_data.json`` as a new active version for a language.

    The raw JSON object is stored as-is. Uploading deactivates every other version
    **for that language only** and makes the new one active immediately.
    """
    lang = _validate_language(language)

    version_clean = (version or "").strip()
    if not version_clean:
        raise HTTPException(status_code=400, detail="Version must not be empty.")

    raw = await file.read(MAX_PROFILE_JSON_BYTES + 1)
    if len(raw) > MAX_PROFILE_JSON_BYTES:
        raise HTTPException(
            status_code=413,
            detail=f"Profile JSON exceeds {MAX_PROFILE_JSON_BYTES // (1024 * 1024)} MB limit.",
        )
    try:
        data = json.loads(raw)
    except (json.JSONDecodeError, UnicodeDecodeError):
        raise HTTPException(status_code=400, detail="File is not valid JSON.")
    if not isinstance(data, dict):
        raise HTTPException(
            status_code=400, detail="Profile JSON must be a top-level object."
        )

    # Reject duplicate (version, language) up front for a clean 409.
    existing = await db.scalar(
        select(ProfileSnapshot).where(
            ProfileSnapshot.version == version_clean,
            ProfileSnapshot.language == lang,
        )
    )
    if existing is not None:
        raise HTTPException(
            status_code=409,
            detail=f"Version '{version_clean}' already exists for language '{lang}'.",
        )

    try:
        # Deactivate other versions for THIS language only (multilanguage-safe).
        await db.execute(
            update(ProfileSnapshot)
            .where(ProfileSnapshot.language == lang)
            .values(is_active=False)
        )
        row = ProfileSnapshot(
            version=version_clean, language=lang, data=data, is_active=True
        )
        db.add(row)
        await db.commit()
        await db.refresh(row)
        logger.info(
            "Admin %s uploaded profile version %s (%s)",
            admin.email,
            version_clean,
            lang,
        )
        return {"success": True, "version": version_clean, "language": lang}
    except Exception as e:
        logger.error("Error uploading profile: %s", e)
        await db.rollback()
        raise HTTPException(status_code=500, detail="Failed to upload profile")


@router.get("/versions")
async def get_profile_snapshots(
    page: int = Query(1, ge=1),
    page_size: int = Query(10, ge=1, le=100),
    sort_by: str = Query("created_at"),
    sort_order: str = Query("desc", pattern="^(asc|desc)$"),
    language: str = Query(None, description="Filter by language (en|de)"),
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(get_current_admin_user),
):
    """Paginated version list (metadata only — the raw ``data`` blob is omitted)."""
    query = select(ProfileSnapshot)
    if language:
        query = query.where(ProfileSnapshot.language == language.lower())

    total_raw = await db.scalar(select(func.count()).select_from(query.subquery()))
    total = int(total_raw) if total_raw is not None else 0

    if sort_by in SORTABLE_COLUMNS:
        order_column = getattr(ProfileSnapshot, sort_by)
        query = query.order_by(
            order_column.desc() if sort_order == "desc" else order_column.asc()
        )
    else:
        query = query.order_by(ProfileSnapshot.created_at.desc())

    offset = (page - 1) * page_size
    query = query.offset(offset).limit(page_size)

    result = await db.execute(query)
    rows = result.scalars().all()
    total_pages = ceil(total / page_size) if total > 0 else 1

    return {
        "items": [
            {
                "id": row.id,
                "version": row.version,
                "language": row.language,
                "is_active": row.is_active,
                "created_at": row.created_at,
            }
            for row in rows
        ],
        "total": total,
        "page": page,
        "page_size": page_size,
        "total_pages": total_pages,
    }


@router.patch("/versions/{version_id}/activate")
async def activate_profile_version(
    version_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(get_current_admin_user),
):
    """Make an existing version the active one for its language."""
    row = await db.get(ProfileSnapshot, version_id)
    if row is None:
        raise HTTPException(status_code=404, detail="Profile version not found.")

    try:
        await db.execute(
            update(ProfileSnapshot)
            .where(ProfileSnapshot.language == row.language)
            .values(is_active=False)
        )
        row.is_active = True
        await db.commit()
        await db.refresh(row)
        logger.info(
            "Admin %s activated profile version %s (%s)",
            admin.email,
            row.version,
            row.language,
        )
        return {
            "success": True,
            "id": row.id,
            "version": row.version,
            "language": row.language,
        }
    except Exception as e:
        logger.error("Error activating profile version: %s", e)
        await db.rollback()
        raise HTTPException(
            status_code=500, detail="Failed to activate profile version"
        )


# --- Portrait (#333) --------------------------------------------------------

# Bounded like the profile JSON above. Precisely: the HANDLER's read is
# bounded (`file.read(MAX+1)`), so this process never materialises more than
# MAX+1 bytes in memory — but Starlette has already spooled the multipart
# body (to a temp file past its own threshold) before the handler runs, so
# the bound is on handler memory and the stored row, not on request-body
# spooling (#422 review round 1, nit 7). Whole-request size belongs to the
# proxy's client_max_body_size, the layer that sees bytes first.
MAX_PROFILE_PHOTO_BYTES = 5 * 1024 * 1024  # 5 MB

# Magic-byte signatures, not client-declared content types — a filename or a
# Content-Type header is an assertion, the first bytes are evidence. JPEG and
# PNG only: the two formats the issue names and every browser renders.
_PHOTO_SIGNATURES = (
    (b"\xff\xd8\xff", "image/jpeg"),
    (b"\x89PNG\r\n\x1a\n", "image/png"),
)


def _sniff_photo_type(raw: bytes) -> str | None:
    for magic, content_type in _PHOTO_SIGNATURES:
        if raw.startswith(magic):
            return content_type
    return None


@router.post("/photo")
async def upload_profile_photo(
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(get_current_admin_user),
):
    """Upload the owner's portrait (JPEG/PNG). REPLACES any previous one.

    Single-active, no versions: old bytes of a face have no replay value,
    only PII surface (#66) — so the previous row is deleted, not deactivated.
    Served publicly by ``GET /profile/photo``; the DB row survives rollouts,
    which is the whole point (#333).
    """
    raw = await file.read(MAX_PROFILE_PHOTO_BYTES + 1)
    if len(raw) > MAX_PROFILE_PHOTO_BYTES:
        raise HTTPException(
            status_code=413,
            detail=f"Photo exceeds {MAX_PROFILE_PHOTO_BYTES // (1024 * 1024)} MB limit.",
        )
    content_type = _sniff_photo_type(raw)
    if content_type is None:
        raise HTTPException(
            status_code=400,
            detail="File is not a JPEG or PNG image (checked by content, not filename).",
        )
    try:
        await db.execute(delete(ProfilePhoto))
        photo = ProfilePhoto(content_type=content_type, data=raw)
        db.add(photo)
        await db.commit()
        await db.refresh(photo)
    except Exception as e:
        logger.error("Error storing profile photo: %s", e)
        await db.rollback()
        raise HTTPException(status_code=500, detail="Failed to store profile photo")
    logger.info(
        "Admin %s uploaded profile photo (%s, %d bytes)",
        admin.email,
        content_type,
        len(raw),
    )
    return {
        "success": True,
        "id": photo.id,
        "content_type": content_type,
        "bytes": len(raw),
    }


@router.delete("/photo")
async def delete_profile_photo(
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(get_current_admin_user),
):
    """Remove the portrait: the public endpoint 404s again and the hero
    falls back to its baked placeholder — the pristine fork state."""
    try:
        result = await db.execute(delete(ProfilePhoto))
        await db.commit()
    except Exception as e:
        logger.error("Error deleting profile photo: %s", e)
        await db.rollback()
        raise HTTPException(status_code=500, detail="Failed to delete profile photo")
    # CursorResult in practice; typed as Result, which lacks rowcount.
    removed = int(getattr(result, "rowcount", 0))
    logger.info("Admin %s removed profile photo (%d row(s))", admin.email, removed)
    return {"success": True, "removed": removed}
