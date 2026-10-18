"""Search must be language-AWARE, not language-EXCLUSIVE, and rank keyword
hits above loosely related vectors.

Owner report: searching "Hamilton" did not find the two Margaret Hamilton
posts. They are English but were tagged ``de`` by the importer's old
single-hit heuristic, and ``semantic_search`` hard-filtered BOTH its vector and
its keyword query on ``Post.language == lang`` — so they could not surface for
an English visitor, while ten unrelated English vectors at 0.43-0.49 cleared
the old 0.3 floor.

Handlers are called directly (as in ``test_cov_posts.py``) so coverage tracks
the post-``await`` lines, against a live Postgres session.
"""

import pytest
from pgvector.sqlalchemy import Vector
from sqlalchemy import case, literal

from app.api import posts as posts_api
from app.models.post import Post


class _approx:
    """Float equality within 1e-9. (``pytest.approx`` is unusable here: the
    suite's conftest mocks numpy, and approx probes ``numpy.ndarray``.)"""

    def __init__(self, expected):
        self.expected = expected

    def __eq__(self, actual):
        return abs(actual - self.expected) < 1e-9

    def __repr__(self):
        return f"~{self.expected}"


async def _post(db_session, slug, *, language="en", **kwargs):
    fields = {
        "title": slug.replace("-", " ").title(),
        "slug": slug,
        "content": "Content body",
        "summary": "A summary",
        "language": language,
        "published": True,
        "tags": [],
        "embedding": [0.1] * 768,
    }
    fields.update(kwargs)
    post = Post(**fields)
    db_session.add(post)
    await db_session.commit()
    await db_session.refresh(post)
    return post


@pytest.fixture
def vector_relevance(monkeypatch):
    """Control the vector score per post. The suite's MockVector answers a flat
    0.5 for every row, which cannot express a ranking; this swaps in a CASE on
    the slug so each post gets the relevance (1 - distance) the test names."""

    def _set(by_slug, default=0.0):
        def cosine_distance(self, other):
            if not by_slug:
                return literal(1 - default)
            return case(
                *(
                    (Post.slug == slug, literal(1 - rel))
                    for slug, rel in by_slug.items()
                ),
                else_=literal(1 - default),
            )

        monkeypatch.setattr(Vector.Comparator, "cosine_distance", cosine_distance)

    return _set


async def _search(db_session, q, lang="en", **kwargs):
    kwargs.setdefault("limit", 10)
    kwargs.setdefault("min_relevance", posts_api.SEARCH_MIN_RELEVANCE)
    return await posts_api.semantic_search(q=q, lang=lang, db=db_session, **kwargs)


# --- language: a preference, never a filter --------------------------------


@pytest.mark.asyncio
async def test_english_post_tagged_de_is_found_by_keyword_with_lang_en(
    db_session, vector_relevance
):
    """THE regression: the Hamilton posts carry language='de'."""
    vector_relevance({}, default=0.0)  # vector path contributes nothing
    await _post(
        db_session,
        "margaret-hamilton",
        language="de",
        content="Margaret Hamilton led software engineering at the MIT lab.",
    )
    results = await _search(db_session, "Hamilton", lang="en")
    assert [r["slug"] for r in results] == ["margaret-hamilton"]
    assert results[0]["relevance"] == _approx(posts_api.SEARCH_KEYWORD_SCORE)


@pytest.mark.asyncio
async def test_post_tagged_en_is_found_by_keyword_with_lang_de(
    db_session, vector_relevance
):
    vector_relevance({}, default=0.0)
    await _post(db_session, "apollo-guidance", content="The Apollo guidance computer")
    results = await _search(db_session, "Apollo", lang="de")
    assert [r["slug"] for r in results] == ["apollo-guidance"]


@pytest.mark.asyncio
async def test_vector_results_are_not_filtered_by_language(
    db_session, vector_relevance
):
    """A strong vector match in the other language still surfaces."""
    vector_relevance({"de-match": 0.7}, default=0.0)
    await _post(db_session, "de-match", language="de", content="Etwas anderes")
    results = await _search(db_session, "unrelated words", lang="en")
    assert [r["slug"] for r in results] == ["de-match"]
    assert results[0]["relevance"] == _approx(0.7)  # no boost: other lang


@pytest.mark.asyncio
async def test_requested_language_gets_a_small_boost_and_wins_ties(
    db_session, vector_relevance
):
    vector_relevance({"en-vec": 0.6, "de-vec": 0.6}, default=0.0)
    await _post(db_session, "de-vec", language="de", content="eins")
    await _post(db_session, "en-vec", language="en", content="two")
    results = await _search(db_session, "zz-no-keyword", lang="en")
    assert [r["slug"] for r in results] == ["en-vec", "de-vec"]
    assert results[0]["relevance"] == _approx(0.6 + posts_api.SEARCH_LANG_BOOST)
    assert results[1]["relevance"] == _approx(0.6)

    # Equal keyword scores: the requested language comes first either way round.
    vector_relevance({}, default=0.0)
    await _post(db_session, "kw-de", language="de", content="shared needle")
    await _post(db_session, "kw-en", language="en", content="shared needle")
    for lang, first in (("en", "kw-en"), ("de", "kw-de")):
        results = await _search(db_session, "needle", lang=lang)
        assert results[0]["slug"] == first


# --- ranking ---------------------------------------------------------------


@pytest.mark.asyncio
async def test_keyword_hit_outranks_a_stronger_vector_only_hit(
    db_session, vector_relevance
):
    """Exact-term evidence leads; vector-only scores are capped below it."""
    vector_relevance({"vector-only": 0.95, "keyword": 0.0})
    await _post(db_session, "vector-only", content="nothing literal here")
    await _post(db_session, "keyword", content="Margaret Hamilton")
    results = await _search(db_session, "Hamilton")
    assert [r["slug"] for r in results] == ["keyword", "vector-only"]
    assert results[0]["relevance"] == _approx(posts_api.SEARCH_KEYWORD_SCORE)
    assert results[1]["relevance"] == _approx(posts_api.SEARCH_VECTOR_ONLY_CEILING)
    # The response stays sorted by the relevance it reports.
    assert [r["relevance"] for r in results] == sorted(
        (r["relevance"] for r in results), reverse=True
    )


@pytest.mark.asyncio
async def test_hybrid_hit_outranks_keyword_only_and_appears_once(
    db_session, vector_relevance
):
    vector_relevance({"both": 0.6, "kw-only": 0.1})
    await _post(db_session, "kw-only", content="Hamilton once")
    await _post(db_session, "both", content="Hamilton and more")
    results = await _search(db_session, "Hamilton")
    assert [r["slug"] for r in results] == ["both", "kw-only"]  # de-duplicated
    assert results[0]["relevance"] == _approx(
        posts_api.SEARCH_KEYWORD_SCORE + posts_api.SEARCH_HYBRID_BONUS
    )


@pytest.mark.asyncio
async def test_default_floor_drops_the_measured_unrelated_band(
    db_session, vector_relevance
):
    """0.43-0.49 is what unrelated posts scored for "Hamilton" in prod; the
    old 0.3 floor let all of them in."""
    vector_relevance({"unrelated-a": 0.49, "unrelated-b": 0.43, "related": 0.55})
    for slug in ("unrelated-a", "unrelated-b", "related"):
        await _post(db_session, slug, content="body")
    results = await posts_api.semantic_search(q="zzquery", db=db_session)
    assert [r["slug"] for r in results] == ["related"]


@pytest.mark.asyncio
async def test_limit_caps_the_merged_result(db_session, vector_relevance):
    vector_relevance({}, default=0.0)
    for i in range(4):
        await _post(db_session, f"capped-{i}", content="needle")
    results = await _search(db_session, "needle", limit=2)
    assert len(results) == 2


@pytest.mark.asyncio
async def test_keyword_fetch_is_wider_than_limit_so_ranking_sees_better_hits(
    db_session, vector_relevance
):
    """The keyword query is ordered by recency, the RESULT by relevance. If it
    fetched only ``limit`` rows, an older post with the verbatim phrase (the
    higher score) would be cut before ranking ever saw it."""
    vector_relevance({}, default=0.0)
    await _post(db_session, "old-verbatim", content="alpha beta")
    await _post(db_session, "new-split-1", content="alpha then beta")
    await _post(db_session, "new-split-2", content="beta then alpha")
    results = await _search(db_session, "alpha beta", limit=2)
    assert results[0]["slug"] == "old-verbatim"


# --- query handling --------------------------------------------------------


@pytest.mark.asyncio
async def test_multi_word_query_requires_every_term_in_any_field(
    db_session, vector_relevance
):
    vector_relevance({}, default=0.0)
    # terms split across title and content still match
    await _post(
        db_session, "split", title="Margaret's legacy", content="Hamilton at MIT"
    )
    await _post(db_session, "only-one", content="Margaret Thatcher")
    results = await _search(db_session, "Margaret Hamilton")
    assert [r["slug"] for r in results] == ["split"]


@pytest.mark.asyncio
async def test_phrase_match_ranks_above_scattered_terms(db_session, vector_relevance):
    vector_relevance({}, default=0.0)
    await _post(db_session, "scattered", content="Hamilton wrote it. Margaret too.")
    await _post(db_session, "phrase", content="Thanks, Margaret   Hamilton!")
    results = await _search(db_session, "margaret hamilton")
    assert [r["slug"] for r in results] == ["phrase", "scattered"]
    assert results[0]["relevance"] == _approx(
        posts_api.SEARCH_KEYWORD_SCORE + posts_api.SEARCH_PHRASE_BONUS
    )
    assert results[1]["relevance"] == _approx(posts_api.SEARCH_KEYWORD_SCORE)


@pytest.mark.asyncio
@pytest.mark.parametrize("q", ["100%", "50%_off", "a_b", "back\\slash"])
async def test_like_wildcards_in_the_query_are_literal(db_session, vector_relevance, q):
    """`%` and `_` in user input must not act as wildcards.

    What this pins is the ESCAPING in ``_like_contains`` (mutation-checked:
    removing it fails 5 cases). The explicit ``escape="\\"`` on ``ilike`` is
    observably identical on Postgres — backslash is already its default LIKE
    escape — so no case here can fail without it; it stays for portability and
    to state the contract at the call site."""
    vector_relevance({}, default=0.0)
    await _post(db_session, "literal", content=f"contains {q} literally")
    # Would match if `%`/`_`/`\` were interpreted (`\s` -> `s` as an escape).
    await _post(db_session, "decoy", content="contains 100 50XYoff aXb backslash")
    results = await _search(db_session, q)
    assert [r["slug"] for r in results] == ["literal"]


@pytest.mark.asyncio
async def test_lone_wildcard_query_matches_nothing(db_session, vector_relevance):
    vector_relevance({}, default=0.0)
    await _post(db_session, "any-post", content="ordinary text")
    assert await _search(db_session, "%%") == []
    assert await _search(db_session, "__") == []


def test_search_terms_tokenises_strips_and_dedups():
    assert posts_api._search_terms('  "Margaret" HAMILTON, hamilton! (MIT) ') == [
        "Margaret",
        "HAMILTON",
        "MIT",
    ]
    # 1-char tokens are dropped, unless nothing else is left
    assert posts_api._search_terms("C a Hamilton") == ["Hamilton"]
    assert posts_api._search_terms("a b") == ["a b"]
    assert len(posts_api._search_terms(" ".join(f"t{i}" for i in range(20)))) == 8


# --- embedding failure still falls back to keyword -------------------------


@pytest.mark.asyncio
@pytest.mark.parametrize("failure", ["none", "raises"])
async def test_embedding_failure_falls_back_to_cross_language_keyword(
    db_session, mocker, failure
):
    if failure == "none":
        mocker.patch("app.api.posts.get_embedding", return_value=None)
    else:
        mocker.patch(
            "app.api.posts.get_embedding", side_effect=RuntimeError("ollama down")
        )
    await _post(db_session, "hamilton-de", language="de", content="Margaret Hamilton")
    results = await _search(db_session, "Hamilton", lang="en")
    assert [r["slug"] for r in results] == ["hamilton-de"]
