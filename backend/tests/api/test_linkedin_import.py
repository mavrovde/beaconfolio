"""Tests for POST /api/app/linkedin/import-post (spec 04)."""

from unittest.mock import patch

import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.main import app
from app.models.post import Post
from app.models.user import User
from app.services.auth import get_current_user_optional

URL = f"{settings.api_prefix}/linkedin/import-post"
TOKEN = "test-import-token"
PNG = b"\x89PNG\r\n\x1a\n" + b"0" * 32


@pytest.fixture(autouse=True)
def _set_token(monkeypatch):
    monkeypatch.setattr(settings, "linkedin_import_token", TOKEN)


def _hdr(token=TOKEN):
    return {"X-Import-Token": token} if token is not None else {}


async def _get_post(db: AsyncSession, urn: str) -> Post:
    return (await db.execute(select(Post).where(Post.source_urn == urn))).scalar_one()


# --- auth matrix ------------------------------------------------------------


async def test_valid_token_creates_draft_with_local_image(
    clean_client: AsyncClient, db_session: AsyncSession
):
    r = await clean_client.post(
        URL,
        data={"content": "Hello from LinkedIn", "urn": "urn:li:activity:1"},
        files={"image": ("p.png", PNG, "image/png")},
        headers=_hdr(),
    )
    assert r.status_code == 200
    body = r.json()
    assert body["created"] is True and body["id"]

    post = await _get_post(db_session, "urn:li:activity:1")
    assert post.published is False  # draft
    assert (
        post.image_type == "image/png"
    )  # (image_blob is deferred; verified via GET below)
    # image is served from OUR domain, not media.licdn.com
    assert post.display_image_url == f"{settings.api_prefix}/posts/{post.id}/image"
    img = await clean_client.get(f"{settings.api_prefix}/posts/{post.id}/image")
    assert img.status_code == 200 and img.content == PNG


async def test_text_only_import_keeps_full_body(
    clean_client: AsyncClient, db_session: AsyncSession
):
    text = "First line\n\nSecond paragraph with detail."
    r = await clean_client.post(
        URL, data={"content": text, "urn": "urn:li:activity:text"}, headers=_hdr()
    )
    assert r.status_code == 200
    post = await _get_post(db_session, "urn:li:activity:text")
    assert post.content == text
    assert post.image_type is None


async def test_missing_token_and_no_jwt_is_401(clean_client: AsyncClient):
    r = await clean_client.post(
        URL, data={"content": "x", "urn": "urn:li:activity:noauth"}, headers={}
    )
    assert r.status_code == 401


async def test_wrong_token_is_401(clean_client: AsyncClient):
    r = await clean_client.post(
        URL,
        data={"content": "x", "urn": "urn:li:activity:wrong"},
        headers=_hdr("nope"),
    )
    assert r.status_code == 401


async def test_blank_configured_token_never_authenticates(
    clean_client: AsyncClient, monkeypatch
):
    monkeypatch.setattr(settings, "linkedin_import_token", "")
    r = await clean_client.post(
        URL,
        data={"content": "x", "urn": "urn:li:activity:blank"},
        headers={"X-Import-Token": ""},
    )
    assert r.status_code == 401


async def test_admin_jwt_path_authorizes(
    clean_client: AsyncClient, db_session: AsyncSession
):
    app.dependency_overrides[get_current_user_optional] = lambda: User(
        id=1, username="admin", is_admin=True
    )
    try:
        r = await clean_client.post(
            URL,
            data={"content": "via jwt", "urn": "urn:li:activity:jwt"},
            headers={},  # no token; admin session authorizes
        )
        assert r.status_code == 200
    finally:
        app.dependency_overrides.pop(get_current_user_optional, None)


# --- image validation -------------------------------------------------------


async def test_unsupported_image_type_is_415(clean_client: AsyncClient):
    r = await clean_client.post(
        URL,
        data={"content": "x", "urn": "urn:li:activity:svg"},
        files={"image": ("x.svg", b"<svg/>", "image/svg+xml")},
        headers=_hdr(),
    )
    assert r.status_code == 415


async def test_oversized_image_is_413(clean_client: AsyncClient, monkeypatch):
    monkeypatch.setattr(settings, "import_max_image_mb", 1)
    big = b"0" * (1024 * 1024 + 1)
    r = await clean_client.post(
        URL,
        data={"content": "x", "urn": "urn:li:activity:big"},
        files={"image": ("big.jpg", big, "image/jpeg")},
        headers=_hdr(),
    )
    assert r.status_code == 413


# --- idempotent upsert ------------------------------------------------------


async def test_same_urn_twice_updates_not_duplicates(
    clean_client: AsyncClient, db_session: AsyncSession
):
    urn = "urn:li:activity:dup"
    r1 = await clean_client.post(
        URL, data={"content": "v1", "urn": urn}, headers=_hdr()
    )
    assert r1.json()["created"] is True
    r2 = await clean_client.post(
        URL,
        data={
            "content": "v2 updated",
            "urn": urn,
            "posted_at": "2026-07-04T10:00:00Z",
            "source_url": "https://lnkd.in/x",
        },
        files={"image": ("p.png", PNG, "image/png")},
        headers=_hdr(),
    )
    assert r2.status_code == 200
    assert r2.json()["created"] is False
    assert r2.json()["id"] == r1.json()["id"]

    rows = (
        (await db_session.execute(select(Post).where(Post.source_urn == urn)))
        .scalars()
        .all()
    )
    assert len(rows) == 1
    post = rows[0]
    assert post.content == "v2 updated"
    assert post.image_type == "image/png"
    assert post.source_url == "https://lnkd.in/x"
    assert post.posted_at is not None


# --- content normalization + provenance + tags ------------------------------


async def test_content_normalized_and_tags_from_hashtags(
    clean_client: AsyncClient, db_session: AsyncSession
):
    raw = "Great insight\u200b\nhashtag\n#AI \nhashtag\n#Cloud"
    r = await clean_client.post(
        URL,
        data={
            "content": raw,
            "urn": "urn:li:activity:norm",
            "source_url": "https://lnkd.in/y",
            "posted_at": "2026-07-01T09:30:00Z",
        },
        headers=_hdr(),
    )
    assert r.status_code == 200
    post = await _get_post(db_session, "urn:li:activity:norm")
    assert "hashtag" not in post.content
    assert "\u200b" not in post.content
    assert post.tags == ["LinkedIn", "AI", "Cloud"]
    assert post.source_urn == "urn:li:activity:norm"
    assert post.source_url == "https://lnkd.in/y"
    assert post.posted_at is not None


async def test_explicit_tags_and_language(
    clean_client: AsyncClient, db_session: AsyncSession
):
    r = await clean_client.post(
        URL,
        data={
            "content": "Deutscher Beitrag",
            "urn": "urn:li:activity:de",
            "language": "de",
            "tags": "a,b,c,d,e,f",  # capped at 5 incl. LinkedIn
        },
        headers=_hdr(),
    )
    assert r.status_code == 200
    post = await _get_post(db_session, "urn:li:activity:de")
    assert post.language == "de"
    assert post.tags == ["LinkedIn", "a", "b", "c", "d"]


async def test_long_title_truncated_and_invalid_date_ignored(
    clean_client: AsyncClient, db_session: AsyncSession
):
    long_line = "word " * 30  # >60 chars, has spaces
    r = await clean_client.post(
        URL,
        data={
            "content": long_line,
            "urn": "urn:li:activity:long",
            "posted_at": "not-a-date",
        },
        headers=_hdr(),
    )
    assert r.status_code == 200
    post = await _get_post(db_session, "urn:li:activity:long")
    # TITLE_MAX_CHARS (70) INCLUDING the ellipsis, cut on a word boundary.
    assert post.title.endswith("word…") and len(post.title) <= 70
    assert post.posted_at is None  # unparseable date ignored


async def test_whitespace_content_gets_default_title(
    clean_client: AsyncClient, db_session: AsyncSession
):
    r = await clean_client.post(
        URL, data={"content": "   ", "urn": "urn:li:activity:ws"}, headers=_hdr()
    )
    assert r.status_code == 200
    post = await _get_post(db_session, "urn:li:activity:ws")
    assert post.title == "LinkedIn Post"


async def test_explicit_title_and_summary_used(
    clean_client: AsyncClient, db_session: AsyncSession
):
    r = await clean_client.post(
        URL,
        data={
            "content": "body",
            "urn": "urn:li:activity:titled",
            "title": "Custom Title",
            "summary": "Custom summary",
            "published": "true",
        },
        headers=_hdr(),
    )
    assert r.status_code == 200
    post = await _get_post(db_session, "urn:li:activity:titled")
    assert post.title == "Custom Title"
    assert post.summary == "Custom summary"
    assert post.published is True


# --- slug collision retry ---------------------------------------------------


async def test_slug_collision_retries(
    clean_client: AsyncClient, db_session: AsyncSession
):
    # Force identical slug suffixes so the second create collides on (slug, language)
    # and takes the retry branch: A=1111, B first attempt 1111 (collide) then 2222.
    with patch("app.api.linkedin.random.randint", side_effect=[1111, 1111, 2222]):
        a = await clean_client.post(
            URL, data={"content": "Same Title", "urn": "urn:a"}, headers=_hdr()
        )
        b = await clean_client.post(
            URL, data={"content": "Same Title", "urn": "urn:b"}, headers=_hdr()
        )
    assert a.status_code == 200 and b.status_code == 200
    assert a.json()["slug"] != b.json()["slug"]
    assert b.json()["slug"].endswith("2222")


async def test_long_single_word_title_no_space(
    clean_client: AsyncClient, db_session: AsyncSession
):
    # First line >60 chars with NO space → title truncated without word-boundary split.
    r = await clean_client.post(
        URL,
        data={"content": "x" * 80, "urn": "urn:li:activity:oneword"},
        headers=_hdr(),
    )
    assert r.status_code == 200
    post = await _get_post(db_session, "urn:li:activity:oneword")
    assert post.title.endswith("…")


async def test_duplicate_tags_are_deduped(
    clean_client: AsyncClient, db_session: AsyncSession
):
    r = await clean_client.post(
        URL,
        data={"content": "x", "urn": "urn:li:activity:duptags", "tags": "a,a,b"},
        headers=_hdr(),
    )
    assert r.status_code == 200
    post = await _get_post(db_session, "urn:li:activity:duptags")
    assert post.tags == ["LinkedIn", "a", "b"]


async def test_update_without_new_image(
    clean_client: AsyncClient, db_session: AsyncSession
):
    urn = "urn:li:activity:noimg-update"
    await clean_client.post(URL, data={"content": "v1", "urn": urn}, headers=_hdr())
    r = await clean_client.post(
        URL, data={"content": "v2 no image", "urn": urn}, headers=_hdr()
    )
    assert r.status_code == 200 and r.json()["created"] is False
    post = await _get_post(db_session, urn)
    assert post.content == "v2 no image"
    assert post.image_type is None
