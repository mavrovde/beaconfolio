"""Public post payloads carry the PUBLICATION date (posted_at), order by it,
and support conditional GET (v1.17.0 SEO data correctness).

The live symptom: 82 imported posts all claimed the import day as their date,
because every payload exposed only ``created_at`` (the row's creation)."""

from datetime import UTC, datetime, timedelta

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.models.post import Post

POSTS = f"{settings.api_prefix}/posts"
IMPORT_DAY = datetime(2026, 10, 18, 8, 23, tzinfo=UTC)


def _post(slug: str, *, posted_at: datetime | None, created_at=IMPORT_DAY, **kw):
    return Post(
        title=kw.pop("title", slug),
        slug=slug,
        content=kw.pop("content", f"body of {slug}"),
        summary=kw.pop("summary", f"summary of {slug}"),
        language="en",
        published=kw.pop("published", True),
        tags=["LinkedIn"],
        posted_at=posted_at,
        created_at=created_at,
        **kw,
    )


@pytest.fixture
async def seeded(db_session: AsyncSession) -> dict[str, Post]:
    """Three imports created the SAME second (one batch) with distinct
    LinkedIn dates, plus one native post written later with no posted_at."""
    rows = {
        "jan": _post("jan", posted_at=datetime(2026, 1, 25, 9, 0, tzinfo=UTC)),
        "mar": _post("mar", posted_at=datetime(2026, 3, 2, 9, 0, tzinfo=UTC)),
        "feb": _post("feb", posted_at=datetime(2026, 2, 14, 9, 0, tzinfo=UTC)),
        "native": _post(
            "native", posted_at=None, created_at=IMPORT_DAY - timedelta(days=30)
        ),
    }
    db_session.add_all(rows.values())
    await db_session.commit()
    return rows


async def test_list_exposes_posted_at_and_updated_at(
    client: AsyncClient, seeded: dict[str, Post]
):
    r = await client.get(POSTS)
    assert r.status_code == 200
    items = {i["slug"]: i for i in r.json()["items"]}
    assert items["jan"]["posted_at"] == "2026-01-25T09:00:00+00:00"
    assert items["jan"]["created_at"].startswith("2026-10-18T08:23")  # unchanged
    assert items["native"]["posted_at"] is None
    assert items["jan"]["updated_at"] is not None


async def test_default_order_is_newest_first_by_publication_date(
    client: AsyncClient, seeded: dict[str, Post]
):
    """COALESCE(posted_at, created_at) DESC: the native post (created
    2026-09-18) sorts before March, and the batch is ordered by LinkedIn date,
    not by id/import order."""
    r = await client.get(POSTS)
    assert [i["slug"] for i in r.json()["items"]] == ["native", "mar", "feb", "jan"]


async def test_published_at_sort_ascending(client: AsyncClient, seeded):
    r = await client.get(POSTS, params={"sort_by": "published_at", "sort_order": "asc"})
    assert [i["slug"] for i in r.json()["items"]] == ["jan", "feb", "mar", "native"]


async def test_created_at_sort_still_available(client: AsyncClient, seeded):
    r = await client.get(POSTS, params={"sort_by": "created_at", "sort_order": "asc"})
    slugs = [i["slug"] for i in r.json()["items"]]
    assert slugs[0] == "native"  # created a month before the batch
    assert sorted(slugs[1:]) == ["feb", "jan", "mar"]


async def test_posted_at_sort_puts_nulls_last_both_ways(client: AsyncClient, seeded):
    desc = await client.get(POSTS, params={"sort_by": "posted_at"})
    assert [i["slug"] for i in desc.json()["items"]] == ["mar", "feb", "jan", "native"]
    asc = await client.get(POSTS, params={"sort_by": "posted_at", "sort_order": "asc"})
    assert [i["slug"] for i in asc.json()["items"]] == ["jan", "feb", "mar", "native"]


@pytest.mark.parametrize(
    "field", ["display_image_url", "image_blob", "embedding", "nope", "__class__"]
)
async def test_unsortable_field_falls_back_to_default_order(
    client: AsyncClient, seeded, field: str
):
    """``hasattr(Post, …)`` used to admit a Python property
    (``display_image_url`` → ``.desc()`` AttributeError → 500) and the deferred
    blob/vector columns."""
    r = await client.get(POSTS, params={"sort_by": field, "sort_order": "asc"})
    assert r.status_code == 200
    assert [i["slug"] for i in r.json()["items"]] == ["native", "mar", "feb", "jan"]


async def test_detail_by_slug_and_id_expose_posted_at(
    client: AsyncClient, seeded: dict[str, Post]
):
    by_slug = await client.get(f"{POSTS}/feb")
    assert by_slug.status_code == 200
    assert by_slug.json()["posted_at"] == "2026-02-14T09:00:00+00:00"
    by_id = await client.get(f"{POSTS}/{seeded['feb'].id}")
    assert by_id.json()["posted_at"] == "2026-02-14T09:00:00+00:00"
    native = await client.get(f"{POSTS}/native")
    assert native.json()["posted_at"] is None


async def test_similar_posts_expose_posted_at(
    client: AsyncClient, db_session: AsyncSession
):
    a = _post("sim-a", posted_at=None, embedding=[0.1] * settings.embedding_dimensions)
    b = _post(
        "sim-b",
        posted_at=datetime(2026, 1, 25, tzinfo=UTC),
        embedding=[0.1] * settings.embedding_dimensions,
    )
    db_session.add_all([a, b])
    await db_session.commit()
    r = await client.get(f"{POSTS}/sim-a/similar")
    assert r.status_code == 200
    assert r.json()[0]["slug"] == "sim-b"
    assert r.json()[0]["posted_at"] == "2026-01-25T00:00:00+00:00"


async def test_semantic_search_exposes_posted_at(
    client: AsyncClient, db_session: AsyncSession
):
    db_session.add(
        _post(
            "kw",
            posted_at=datetime(2026, 1, 25, tzinfo=UTC),
            content="observability is a team sport",
        )
    )
    await db_session.commit()
    r = await client.get(f"{POSTS}/search/semantic", params={"q": "observability"})
    assert r.status_code == 200
    assert r.json()[0]["posted_at"] == "2026-01-25T00:00:00+00:00"


# --- conditional GET ----------------------------------------------------------


async def test_detail_carries_validators_and_revalidates_to_304(
    client: AsyncClient, seeded: dict[str, Post]
):
    first = await client.get(f"{POSTS}/jan")
    etag = first.headers["etag"]
    assert etag.startswith('W/"')
    assert first.headers["cache-control"] == "no-cache"
    assert "Authorization" in first.headers["vary"]
    # RFC 7231 IMF-fixdate of updated_at.
    assert first.headers["last-modified"].endswith(" GMT")

    again = await client.get(f"{POSTS}/jan", headers={"If-None-Match": etag})
    assert again.status_code == 304
    assert again.content == b""
    assert again.headers["etag"] == etag

    by_id = await client.get(
        f"{POSTS}/{seeded['jan'].id}", headers={"If-None-Match": etag}
    )
    assert by_id.status_code == 304


async def test_etag_changes_when_the_post_changes(
    client: AsyncClient, db_session: AsyncSession, seeded: dict[str, Post]
):
    etag = (await client.get(f"{POSTS}/jan")).headers["etag"]
    seeded["jan"].title = "jan, edited"
    await db_session.commit()
    r = await client.get(f"{POSTS}/jan", headers={"If-None-Match": etag})
    assert r.status_code == 200
    assert r.json()["title"] == "jan, edited"
    assert r.headers["etag"] != etag


@pytest.mark.parametrize(
    "header,expected",
    [
        ('"something-else"', 200),
        ("*", 304),
        ("STRONG", 304),  # the same opaque tag without W/ still matches (weak compare)
        ('"other", ETAG', 304),  # a list containing it
    ],
)
async def test_if_none_match_forms(
    client: AsyncClient, seeded, header: str, expected: int
):
    etag = (await client.get(f"{POSTS}/jan")).headers["etag"]
    header = header.replace("ETAG", etag).replace("STRONG", etag.removeprefix("W/"))
    r = await client.get(f"{POSTS}/jan", headers={"If-None-Match": header})
    assert r.status_code == expected


async def test_if_modified_since_alone_is_not_honoured(client: AsyncClient, seeded):
    """Deliberate: the admin SQL console can change a row without bumping
    updated_at, so a date-based 304 could serve stale content."""
    first = await client.get(f"{POSTS}/jan")
    r = await client.get(
        f"{POSTS}/jan", headers={"If-Modified-Since": first.headers["last-modified"]}
    )
    assert r.status_code == 200


async def test_list_has_etag_but_no_last_modified(client: AsyncClient, seeded):
    first = await client.get(POSTS)
    assert "last-modified" not in first.headers
    etag = first.headers["etag"]
    assert (await client.get(POSTS, headers={"If-None-Match": etag})).status_code == 304
    # A different page is a different body, hence a different validator.
    other = await client.get(POSTS, params={"page_size": 1})
    assert other.headers["etag"] != etag


async def test_list_etag_changes_when_a_post_is_unpublished(
    client: AsyncClient, db_session: AsyncSession, seeded: dict[str, Post]
):
    etag = (await client.get(POSTS)).headers["etag"]
    seeded["feb"].published = False
    await db_session.commit()
    r = await client.get(POSTS, headers={"If-None-Match": etag})
    assert r.status_code == 200
    assert "feb" not in [i["slug"] for i in r.json()["items"]]


async def test_draft_is_still_404_for_anonymous_reader(
    clean_client: AsyncClient, db_session: AsyncSession
):
    db_session.add(_post("draft", posted_at=None, published=False))
    await db_session.commit()
    r = await clean_client.get(f"{POSTS}/draft", headers={"If-None-Match": "*"})
    assert r.status_code == 404
