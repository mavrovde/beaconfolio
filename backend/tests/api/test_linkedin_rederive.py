"""Derived title/summary on import, the re-import guard, and the
POST /linkedin/rederive-metadata tool (v1.17.0 SEO data correctness)."""

import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.models.post import Post
from app.services.post_metadata import (
    derive_summary,
    derive_title,
    legacy_derive_summary,
    legacy_derive_title,
)

IMPORT_URL = f"{settings.api_prefix}/linkedin/import-post"
JSON_URL = f"{settings.api_prefix}/linkedin/import-posts-json"
REDERIVE_URL = f"{settings.api_prefix}/linkedin/rederive-metadata"
TOKEN = "test-import-token"
HDR = {"X-Import-Token": TOKEN}

BODY = (
    "🚀 Today I learned that observability is a team sport, not a tool. "
    "Here is why it matters for every on-call rotation.\n"
    "#observability #sre\n"
    "Second paragraph with the details that make the summary longer than the "
    "budget so that the cut has to happen on a word boundary somewhere in here."
)


@pytest.fixture(autouse=True)
def _set_token(monkeypatch):
    monkeypatch.setattr(settings, "linkedin_import_token", TOKEN)


async def _post(db: AsyncSession, urn: str) -> Post:
    db.expire_all()
    return (await db.execute(select(Post).where(Post.source_urn == urn))).scalar_one()


def _legacy_row(urn: str, content: str, **overrides) -> Post:
    """A row exactly as the PRE-v1.17.0 import stored it."""
    fields = {
        "title": legacy_derive_title(content),
        "slug": f"legacy-{urn.rsplit(':', 1)[-1]}",
        "content": content,
        "summary": legacy_derive_summary(content),
        "language": "en",
        "published": True,
        "tags": ["LinkedIn"],
        "source_urn": urn,
    }
    fields.update(overrides)
    return Post(**fields)


# --- import uses the new derivation ------------------------------------------


async def test_import_post_derives_clean_title_and_summary(
    clean_client: AsyncClient, db_session: AsyncSession
):
    r = await clean_client.post(
        IMPORT_URL, data={"content": BODY, "urn": "urn:li:activity:new"}, headers=HDR
    )
    assert r.status_code == 200
    post = await _post(db_session, "urn:li:activity:new")
    assert (
        post.title == "Today I learned that observability is a team sport, not a tool"
    )
    assert post.summary == derive_summary(BODY)
    assert len(post.summary) <= 150 and post.summary.endswith("…")
    assert "#" not in post.summary and "🚀" not in post.summary
    # The slug follows the clean title.
    assert post.slug.startswith("today-i-learned-that-observability")


async def test_import_posts_json_derives_clean_title_and_summary(
    clean_client: AsyncClient, db_session: AsyncSession
):
    import json

    payload = json.dumps([{"urn": "urn:li:activity:json1", "content": BODY}])
    r = await clean_client.post(
        JSON_URL,
        files={"file": ("posts.json", payload.encode(), "application/json")},
        headers=HDR,
    )
    assert r.status_code == 200 and r.json()["created"] == 1
    post = await _post(db_session, "urn:li:activity:json1")
    assert post.title == derive_title(BODY)
    assert post.summary == derive_summary(BODY)


# --- re-import guard -----------------------------------------------------------


async def test_reimport_upgrades_untouched_legacy_title_and_summary(
    clean_client: AsyncClient, db_session: AsyncSession
):
    urn = "urn:li:activity:legacy-reimport"
    db_session.add(_legacy_row(urn, BODY))
    await db_session.commit()

    r = await clean_client.post(
        IMPORT_URL, data={"content": BODY, "urn": urn}, headers=HDR
    )
    assert r.status_code == 200 and r.json()["created"] is False
    post = await _post(db_session, urn)
    assert post.title == derive_title(BODY)
    assert post.summary == derive_summary(BODY)


async def test_reimport_never_touches_human_edited_title_or_summary(
    clean_client: AsyncClient, db_session: AsyncSession
):
    urn = "urn:li:activity:human"
    db_session.add(
        _legacy_row(urn, BODY, title="My hand-written title", summary="My blurb.")
    )
    await db_session.commit()

    r = await clean_client.post(
        IMPORT_URL,
        data={"content": BODY + "\nEdited on LinkedIn.", "urn": urn},
        headers=HDR,
    )
    assert r.status_code == 200
    post = await _post(db_session, urn)
    assert post.title == "My hand-written title"
    assert post.summary == "My blurb."
    assert post.content.endswith("Edited on LinkedIn.")  # the body still updates


async def test_reimport_is_stable_no_flapping(
    clean_client: AsyncClient, db_session: AsyncSession
):
    urn = "urn:li:activity:stable"
    for _ in range(3):
        r = await clean_client.post(
            IMPORT_URL, data={"content": BODY, "urn": urn}, headers=HDR
        )
        assert r.status_code == 200
    post = await _post(db_session, urn)
    assert post.title == derive_title(BODY)
    assert post.summary == derive_summary(BODY)


async def test_reimport_follows_a_changed_body_while_title_is_machine_output(
    clean_client: AsyncClient, db_session: AsyncSession
):
    urn = "urn:li:activity:changed-body"
    await clean_client.post(
        IMPORT_URL, data={"content": "First version", "urn": urn}, headers=HDR
    )
    await clean_client.post(
        IMPORT_URL, data={"content": "Second version", "urn": urn}, headers=HDR
    )
    post = await _post(db_session, urn)
    assert post.title == "Second version"
    assert post.summary == "Second version"


async def test_reimport_explicit_title_and_summary_always_apply(
    clean_client: AsyncClient, db_session: AsyncSession
):
    urn = "urn:li:activity:explicit"
    db_session.add(_legacy_row(urn, BODY, title="Human title", summary="Human."))
    await db_session.commit()
    r = await clean_client.post(
        IMPORT_URL,
        data={
            "content": BODY,
            "urn": urn,
            "title": "Caller title",
            "summary": "Caller summary",
        },
        headers=HDR,
    )
    assert r.status_code == 200
    post = await _post(db_session, urn)
    assert post.title == "Caller title"
    assert post.summary == "Caller summary"


async def test_transfer_post_uses_the_derivation(
    client: AsyncClient, db_session: AsyncSession
):
    r = await client.post(
        f"{settings.api_prefix}/linkedin/transfer-post", json={"content": BODY}
    )
    assert r.status_code == 200
    db_session.expire_all()
    post = await db_session.get(Post, r.json()["id"])
    assert post is not None
    assert post.title == derive_title(BODY)
    assert post.summary == derive_summary(BODY)


async def test_transfer_post_of_unreadable_body_gets_default_title_no_summary(
    client: AsyncClient, db_session: AsyncSession
):
    r = await client.post(
        f"{settings.api_prefix}/linkedin/transfer-post", json={"content": "🎉"}
    )
    assert r.status_code == 200
    db_session.expire_all()
    post = await db_session.get(Post, r.json()["id"])
    assert post is not None
    assert post.title == "LinkedIn Post"
    assert post.summary is None


async def test_transfer_post_non_latin_title_gets_fallback_slug(
    client: AsyncClient, db_session: AsyncSession
):
    """A clean title with no [a-z0-9] (e.g. Cyrillic) still yields a slug."""
    r = await client.post(
        f"{settings.api_prefix}/linkedin/transfer-post", json={"content": "Привет мир"}
    )
    assert r.status_code == 200
    db_session.expire_all()
    post = await db_session.get(Post, r.json()["id"])
    assert post is not None
    assert post.title == "Привет мир"
    assert post.slug.startswith("linkedin-post-")


# --- rederive-metadata ---------------------------------------------------------


async def _seed_mixed(db: AsyncSession) -> dict[str, int]:
    rows = {
        "legacy": _legacy_row("urn:li:activity:r1", BODY),
        "human_title": _legacy_row("urn:li:activity:r2", BODY, title="Curated"),
        "human_both": _legacy_row(
            "urn:li:activity:r3", BODY, title="Curated", summary="Curated blurb."
        ),
        "empty_summary": _legacy_row("urn:li:activity:r4", BODY, summary=None),
        "title_only": _legacy_row(
            "urn:li:activity:r6", BODY, summary=derive_summary(BODY)
        ),
        "already_current": _legacy_row(
            "urn:li:activity:r5",
            BODY,
            title=derive_title(BODY),
            summary=derive_summary(BODY),
        ),
        # Not imported: no URN — never in scope.
        "native": Post(
            title=legacy_derive_title(BODY),
            slug="native",
            content=BODY,
            summary=legacy_derive_summary(BODY),
            language="en",
            published=True,
            tags=[],
        ),
    }
    db.add_all(rows.values())
    await db.commit()
    return {k: v.id for k, v in rows.items()}


async def test_rederive_requires_auth(clean_client: AsyncClient):
    r = await clean_client.post(REDERIVE_URL)
    assert r.status_code == 401
    r = await clean_client.post(REDERIVE_URL, headers={"X-Import-Token": "wrong"})
    assert r.status_code == 401


async def test_rederive_accepts_admin_session(client: AsyncClient):
    r = await client.post(REDERIVE_URL)
    assert r.status_code == 200
    assert r.json()["scanned"] == 0 and r.json()["changed"] == 0


async def test_rederive_dry_run_is_the_default_and_writes_nothing(
    clean_client: AsyncClient, db_session: AsyncSession
):
    ids = await _seed_mixed(db_session)
    r = await clean_client.post(REDERIVE_URL, headers=HDR)
    assert r.status_code == 200
    body = r.json()
    assert body["dry_run"] is True
    assert body["scanned"] == 6  # the native post is out of scope
    by_id = {item["id"]: item for item in body["items"]}
    assert set(by_id) == {
        ids["legacy"],
        ids["human_title"],
        ids["empty_summary"],
        ids["title_only"],
    }
    assert by_id[ids["title_only"]]["summary"] is None
    legacy = by_id[ids["legacy"]]
    assert legacy["title"] == {
        "old": legacy_derive_title(BODY),
        "new": derive_title(BODY),
    }
    assert legacy["summary"]["new"] == derive_summary(BODY)
    assert by_id[ids["human_title"]]["title"] is None  # human title kept
    assert by_id[ids["human_title"]]["summary"] is not None
    assert by_id[ids["empty_summary"]]["summary"]["old"] is None
    assert body["kept_human_title"] == 2
    assert body["kept_human_summary"] == 1

    db_session.expire_all()
    row = await db_session.get(Post, ids["legacy"])
    assert row is not None and row.title == legacy_derive_title(BODY)  # untouched


async def test_rederive_apply_changes_only_machine_fields_and_is_idempotent(
    clean_client: AsyncClient, db_session: AsyncSession
):
    ids = await _seed_mixed(db_session)
    slugs_before = {
        p.id: p.slug for p in (await db_session.execute(select(Post))).scalars()
    }
    r = await clean_client.post(f"{REDERIVE_URL}?dry_run=false", headers=HDR)
    assert r.status_code == 200
    assert r.json()["dry_run"] is False and r.json()["changed"] == 4

    db_session.expire_all()
    rows = {p.id: p for p in (await db_session.execute(select(Post))).scalars()}
    assert rows[ids["legacy"]].title == derive_title(BODY)
    assert rows[ids["legacy"]].summary == derive_summary(BODY)
    assert rows[ids["human_title"]].title == "Curated"
    assert rows[ids["human_title"]].summary == derive_summary(BODY)
    assert rows[ids["human_both"]].title == "Curated"
    assert rows[ids["human_both"]].summary == "Curated blurb."
    assert rows[ids["empty_summary"]].summary == derive_summary(BODY)
    assert rows[ids["title_only"]].title == derive_title(BODY)
    # Out of scope: a post written here keeps its (legacy-looking) values.
    assert rows[ids["native"]].title == legacy_derive_title(BODY)
    # Slugs are published URLs — never changed.
    assert {i: p.slug for i, p in rows.items()} == slugs_before

    again = await clean_client.post(f"{REDERIVE_URL}?dry_run=false", headers=HDR)
    assert again.json()["changed"] == 0 and again.json()["items"] == []


async def test_rederive_leaves_empty_summary_alone_when_nothing_derives(
    clean_client: AsyncClient, db_session: AsyncSession
):
    db_session.add(
        _legacy_row("urn:li:activity:emoji", "🎉", title="LinkedIn Post", summary="")
    )
    await db_session.commit()
    r = await clean_client.post(f"{REDERIVE_URL}?dry_run=false", headers=HDR)
    assert r.json()["changed"] == 0
