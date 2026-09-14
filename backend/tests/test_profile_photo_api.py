"""Tests for the runtime profile photo (#333): admin upload + public serving.

Covers the magic-byte type gate (JPEG/PNG by content, not filename), the size
bound, single-active REPLACE semantics, the public 404-before-first-upload
contract the hero's placeholder fallback relies on, and the error/500 path.
"""

from unittest.mock import patch

from httpx import AsyncClient
from sqlalchemy import select

from app.api.admin_profile import MAX_PROFILE_PHOTO_BYTES
from app.config import settings
from app.models.profile_photo import ProfilePhoto

UPLOAD = f"{settings.api_prefix}/admin/profile/photo"
PUBLIC = f"{settings.api_prefix}/profile/photo"

PNG = b"\x89PNG\r\n\x1a\n" + b"fake-png-payload"
JPEG = b"\xff\xd8\xff\xe0" + b"fake-jpeg-payload"


def _file(payload: bytes, name="photo.png", content_type="image/png"):
    return {"file": (name, payload, content_type)}


async def _rows(db_session):
    return (await db_session.execute(select(ProfilePhoto))).scalars().all()


# --- upload -----------------------------------------------------------------


async def test_upload_png_success(client: AsyncClient, db_session):
    r = await client.post(UPLOAD, files=_file(PNG))
    assert r.status_code == 200
    body = r.json()
    assert body["success"] is True
    assert body["content_type"] == "image/png"
    assert body["bytes"] == len(PNG)

    rows = await _rows(db_session)
    assert len(rows) == 1
    assert rows[0].data == PNG


async def test_upload_jpeg_replaces_previous(client: AsyncClient, db_session):
    await client.post(UPLOAD, files=_file(PNG))
    r = await client.post(
        UPLOAD, files=_file(JPEG, name="photo.jpg", content_type="image/jpeg")
    )
    assert r.status_code == 200
    assert r.json()["content_type"] == "image/jpeg"

    # REPLACE, not version: exactly one row remains, and it is the JPEG.
    rows = await _rows(db_session)
    assert len(rows) == 1
    assert rows[0].data == JPEG
    assert rows[0].content_type == "image/jpeg"


async def test_upload_rejects_non_image_despite_claimed_type(client: AsyncClient):
    # A text body with an image/png Content-Type and .png name: the magic-byte
    # sniff must win over both claims.
    r = await client.post(UPLOAD, files=_file(b"GIF89a not actually allowed"))
    assert r.status_code == 400
    assert "not a JPEG or PNG" in r.json()["detail"]


async def test_upload_rejects_empty_body(client: AsyncClient):
    r = await client.post(UPLOAD, files=_file(b""))
    assert r.status_code == 400


async def test_upload_rejects_oversized(client: AsyncClient):
    with patch("app.api.admin_profile.MAX_PROFILE_PHOTO_BYTES", 16):
        r = await client.post(UPLOAD, files=_file(PNG + b"x" * 32))
    assert r.status_code == 413
    assert "limit" in r.json()["detail"]


async def test_upload_size_bound_is_sane():
    # The real bound stays a constant, not a Settings knob — pin its value so a
    # silent edit shows up here.
    assert MAX_PROFILE_PHOTO_BYTES == 5 * 1024 * 1024


async def test_upload_db_error_is_500(client: AsyncClient, db_session):
    with patch("app.api.admin_profile.delete", side_effect=RuntimeError("boom")):
        r = await client.post(UPLOAD, files=_file(PNG))
    assert r.status_code == 500
    assert "Failed to store profile photo" in r.json()["detail"]
    # The rollback left nothing behind.
    assert await _rows(db_session) == []


# --- delete -----------------------------------------------------------------


async def test_delete_removes_photo(client: AsyncClient, db_session):
    await client.post(UPLOAD, files=_file(PNG))
    r = await client.delete(UPLOAD)
    assert r.status_code == 200
    assert r.json() == {"success": True, "removed": 1}
    assert await _rows(db_session) == []
    # The public endpoint is back to its pristine-fork 404.
    assert (await client.get(PUBLIC)).status_code == 404


async def test_delete_with_none_is_removed_zero(client: AsyncClient):
    r = await client.delete(UPLOAD)
    assert r.status_code == 200
    assert r.json() == {"success": True, "removed": 0}


async def test_delete_db_error_is_500(client: AsyncClient):
    with patch("app.api.admin_profile.delete", side_effect=RuntimeError("boom")):
        r = await client.delete(UPLOAD)
    assert r.status_code == 500
    assert "Failed to delete profile photo" in r.json()["detail"]


# --- public serving ---------------------------------------------------------


async def test_get_photo_404_before_first_upload(client: AsyncClient):
    r = await client.get(PUBLIC)
    assert r.status_code == 404


async def test_get_photo_serves_uploaded_bytes(client: AsyncClient):
    await client.post(UPLOAD, files=_file(PNG))
    r = await client.get(PUBLIC)
    assert r.status_code == 200
    assert r.content == PNG
    assert r.headers["content-type"] == "image/png"
    assert r.headers["cache-control"] == "public, max-age=300"


async def test_get_photo_serves_latest_after_replace(client: AsyncClient):
    await client.post(UPLOAD, files=_file(PNG))
    await client.post(
        UPLOAD, files=_file(JPEG, name="p.jpg", content_type="image/jpeg")
    )
    r = await client.get(PUBLIC)
    assert r.status_code == 200
    assert r.content == JPEG
    assert r.headers["content-type"] == "image/jpeg"
