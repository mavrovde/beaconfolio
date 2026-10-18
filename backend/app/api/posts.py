from collections.abc import Sequence
from datetime import datetime
from math import ceil
from typing import Annotated, Any, cast

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile
from pydantic import BaseModel, ConfigDict, Field, field_validator
from sqlalchemy import func, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.conditional import ConditionalGetRoute
from app.database import get_db
from app.logger import get_logger
from app.models.post import Post
from app.models.user import User
from app.services.auth import get_current_admin_user, get_current_user_optional
from app.services.embeddings import get_embedding

logger = get_logger(__name__)

# GET routes carry ETag/Last-Modified and answer If-None-Match with 304 —
# see app/api/conditional.py. Non-GET and non-JSON responses pass through.
router = APIRouter(prefix="/posts", tags=["posts"], route_class=ConditionalGetRoute)


class PostCreate(BaseModel):
    title: str
    slug: str
    content: str
    summary: str | None = None
    image_url: str | None = None
    language: str = "en"
    published: bool = False
    tags: list[str] = []

    @field_validator("tags")
    @classmethod
    def validate_tags(cls, v):
        if len(v) > 5:
            raise ValueError("Max 5 tags allowed")
        return v


class PostUpdate(BaseModel):
    title: str | None = None
    content: str | None = None
    summary: str | None = None
    image_url: str | None = None
    language: str | None = None
    published: bool | None = None
    tags: list[str] | None = None

    @field_validator("tags")
    @classmethod
    def validate_tags(cls, v):
        if v is not None and len(v) > 5:
            raise ValueError("Max 5 tags allowed")
        return v


class PostResponse(BaseModel):
    id: int
    title: str
    slug: str
    content: str
    summary: str | None
    image_url: str | None = Field(None, validation_alias="display_image_url")
    language: str
    published: bool
    tags: list[str]
    created_at: str
    updated_at: str
    # The ORIGINAL publication date of an imported post (LinkedIn's date), ISO
    # 8601, or null for a post written here. ``created_at`` is when the ROW was
    # created — for an import that is the import day, so a consumer that wants
    # the publication date reads ``posted_at ?? created_at`` (the same
    # COALESCE the default list ordering uses).
    posted_at: str | None = None

    model_config = ConfigDict(from_attributes=True, populate_by_name=True)


class PostListResponse(BaseModel):
    id: int
    title: str
    slug: str
    summary: str | None
    image_url: str | None = Field(None, validation_alias="display_image_url")
    language: str
    published: bool
    tags: list[str]
    created_at: str
    # Same meaning as on PostResponse. ``updated_at`` is here for a sitemap's
    # <lastmod>, which is a MODIFICATION date, not a publication date.
    posted_at: str | None = None
    updated_at: str | None = None

    model_config = ConfigDict(from_attributes=True, populate_by_name=True)


class PaginatedPostListResponse(BaseModel):
    items: list[PostListResponse]
    total: int
    page: int
    page_size: int
    total_pages: int


class SimilarPostResponse(BaseModel):
    id: int
    title: str
    slug: str
    summary: str | None
    image_url: str | None = None
    similarity: float
    posted_at: str | None = None


class TagSuggestionRequest(BaseModel):
    title: str
    content: str


class PostDetailSuggestionRequest(BaseModel):
    content: str
    field: str | None = "all"


class PostDetailSuggestionResponse(BaseModel):
    title: str
    slug: str
    summary: str
    tags: list[str]


def _iso(value: datetime | None) -> str | None:
    return value.isoformat() if value is not None else None


def _to_post_response(post: Post) -> PostResponse:
    return PostResponse(
        id=post.id,
        title=post.title,
        slug=post.slug,
        content=post.content,
        summary=post.summary,
        image_url=post.display_image_url,
        language=post.language,
        published=post.published,
        tags=post.tags,
        created_at=post.created_at.isoformat(),
        updated_at=post.updated_at.isoformat(),
        posted_at=_iso(post.posted_at),
    )


# The publication date of a post: LinkedIn's original date for an import, the
# row's creation for a post written here. The DEFAULT list order — an import
# batch must not reorder the blog by import time.
PUBLISHED_AT = func.coalesce(Post.posted_at, Post.created_at)
DEFAULT_SORT = "published_at"
# The columns a client may sort by. An allowlist, not ``hasattr(Post, …)``:
# that admitted ``display_image_url`` (a Python property — ``.desc()`` on it
# raised, a 500) and the deferred ``image_blob``/``embedding`` columns.
SORTABLE_COLUMNS: dict[str, Any] = {
    "published_at": PUBLISHED_AT,
    "created_at": Post.created_at,
    "updated_at": Post.updated_at,
    "posted_at": Post.posted_at,
    "title": Post.title,
    "slug": Post.slug,
    "summary": Post.summary,
    "language": Post.language,
    "published": Post.published,
    "tags": Post.tags,
    "id": Post.id,
}


@router.get("", response_model=PaginatedPostListResponse)
async def list_posts(
    published_only: bool = True,
    lang: str | None = None,
    tag: str | None = None,
    page: int = Query(1, ge=1, description="Page number"),
    page_size: int = Query(10, ge=1, le=100, description="Items per page"),
    sort_by: str = Query(
        DEFAULT_SORT,
        description=(
            "Field to sort by. `published_at` (default) is the publication "
            "date, COALESCE(posted_at, created_at); `created_at` is when the "
            "row was created (the import day, for an imported post). Unknown "
            "fields fall back to `published_at` desc."
        ),
    ),
    sort_order: str = Query("desc", pattern="^(asc|desc)$", description="Sort order"),
    search: str | None = Query(None, description="Search in title and summary"),
    db: AsyncSession = Depends(get_db),
    current_user: User | None = Depends(get_current_user_optional),
) -> PaginatedPostListResponse:
    """List posts with pagination, sorting, and search.

    Carries an ``ETag`` (``If-None-Match`` → ``304``) via the router's
    ``ConditionalGetRoute`` — no ``Last-Modified`` on a LIST: the newest
    ``updated_at`` cannot see a post being deleted or unpublished, the
    body-hash ETag can.
    """
    # Restrict access to drafts
    if not published_only and (not current_user or not current_user.is_admin):
        published_only = True

    # Build base query
    query = select(Post)
    if published_only:
        query = query.where(Post.published.is_(True))
    if lang:
        query = query.where(Post.language == lang)
    if tag:
        query = query.where(Post.tags.contains([tag]))

    # Apply search filter
    if search:
        search_term = f"%{search}%"
        query = query.where(
            (Post.title.ilike(search_term)) | (Post.summary.ilike(search_term))
        )

    # Get total count before pagination
    count_query = select(func.count()).select_from(query.subquery())
    total_raw = await db.scalar(count_query)
    total = int(total_raw) if total_raw is not None else 0

    # Apply sorting. NULLS LAST in both directions: Postgres puts NULLs FIRST
    # on DESC, which would lead a `posted_at` sort with every post written
    # here (no LinkedIn date).
    order_column = SORTABLE_COLUMNS.get(sort_by)
    if order_column is None:
        # Unknown field: the default order (the order_by direction too).
        query = query.order_by(PUBLISHED_AT.desc(), Post.id.desc())
    elif sort_order == "desc":
        query = query.order_by(order_column.desc().nulls_last(), Post.id.desc())
    else:
        query = query.order_by(order_column.asc().nulls_last(), Post.id.asc())

    # Apply pagination
    offset = (page - 1) * page_size
    query = query.offset(offset).limit(page_size)

    # Execute query
    result = await db.execute(query)
    posts = result.scalars().all()

    # Calculate total pages
    total_pages = ceil(total / page_size) if total > 0 else 1

    return PaginatedPostListResponse(
        items=[
            PostListResponse(
                id=p.id,
                title=p.title,
                slug=p.slug,
                summary=p.summary,
                image_url=p.display_image_url,
                language=p.language,
                published=p.published,
                tags=p.tags,
                created_at=p.created_at.isoformat(),
                posted_at=_iso(p.posted_at),
                updated_at=_iso(p.updated_at),
            )
            for p in posts
        ],
        total=total,
        page=page,
        page_size=page_size,
        total_pages=total_pages,
    )


@router.get("/{id:int}", response_model=PostResponse)
async def get_post_by_id(
    id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User | None = Depends(get_current_user_optional),
) -> PostResponse:
    """Get a single post by ID — with ``ETag``/``Last-Modified`` via the
    router's ``ConditionalGetRoute``."""
    result = await db.execute(select(Post).where(Post.id == id))
    post = result.scalar_one_or_none()

    if not post:
        raise HTTPException(status_code=404, detail="Post not found")

    # Check permissions for drafts
    if not post.published and (not current_user or not current_user.is_admin):
        raise HTTPException(status_code=404, detail="Post not found")

    return _to_post_response(post)


# --- semantic_search scoring ------------------------------------------------
# Default vector floor. MEASURED with the production embedding model
# (nomic-embed-text, raw prompt, 1 - cosine distance) against the real 82-post
# export: for 15 probe queries the matching posts scored 0.53-0.72, while the
# best UNRELATED post per query sat at 0.41-0.51 (the median post at 0.31-0.41;
# a nonsense query's best hit 0.41). The old 0.3 floor admitted that whole
# unrelated band — "Hamilton" returned ten unrelated posts at 0.43-0.49. 0.5
# drops the band and keeps every measured true match.
SEARCH_MIN_RELEVANCE = 0.5
# A post that contains every query term. Exact-term evidence outranks embedding
# proximity in a site search box, so it sits above the vector-only ceiling.
SEARCH_KEYWORD_SCORE = 0.85
SEARCH_PHRASE_BONUS = 0.05  # multi-word query found verbatim as a phrase
SEARCH_HYBRID_BONUS = 0.1  # keyword hit that the vector search also returned
# Vector-only hits are capped BELOW every keyword hit, so the response stays
# sorted by `relevance` while keyword matches always lead.
SEARCH_VECTOR_ONLY_CEILING = 0.8
# Small preference for the visitor's language — a preference, never a filter.
SEARCH_LANG_BOOST = 0.02
_SEARCH_MAX_TERMS = 8
_SEARCH_TERM_STRIP = "\"'.,;:!?()[]{}<>“”‘’«»"


def _search_terms(q: str) -> list[str]:
    """Whitespace tokens with surrounding punctuation stripped, case-insensitively
    de-duplicated; 1-char tokens dropped unless nothing else is left."""
    terms: list[str] = []
    seen: set[str] = set()
    for raw in q.split():
        term = raw.strip(_SEARCH_TERM_STRIP)
        if len(term) >= 2 and term.casefold() not in seen:
            seen.add(term.casefold())
            terms.append(term)
    return terms[:_SEARCH_MAX_TERMS] or [q.strip()]


def _like_contains(term: str) -> str:
    """ILIKE pattern matching ``term`` LITERALLY: ``%``, ``_`` and the escape
    character itself are escaped, so user input is never a wildcard."""
    escaped = term.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
    return f"%{escaped}%"


#: Upper bound on ``/search/semantic?limit=`` (the UI asks for 10).
SEARCH_MAX_LIMIT = 50


@router.get("/search/semantic")
async def semantic_search(
    q: str,
    lang: str | None = "en",
    # Bounded: a public, unauthenticated endpoint must not be asked to embed,
    # rank and serialise an arbitrary number of posts per request.
    limit: Annotated[int, Query(ge=1, le=SEARCH_MAX_LIMIT)] = 10,
    min_relevance: float = SEARCH_MIN_RELEVANCE,  # vector floor, see above
    db: AsyncSession = Depends(get_db),
):
    """
    Search posts using hybrid approach: Semantic (Vector) + Keyword (SQL ILIKE).

    Language-aware, not language-exclusive: ``lang`` only boosts/tie-breaks, so
    a post is found whatever language it is tagged with.
    """
    if not q or len(q.strip()) < 2:
        return []

    # 1. Vector Search
    vector_results: list[Any] = []
    try:
        query_embedding = await get_embedding(q)
        if query_embedding:
            vector_query = (
                select(
                    Post,
                    (1 - Post.embedding.cosine_distance(query_embedding)).label(
                        "relevance"
                    ),
                )
                .where(Post.published.is_(True))
                .where(Post.embedding.isnot(None))
                # Fetch slightly more to allow for filtering/reranking
                .order_by(text("relevance DESC"), Post.id.desc())
                .limit(limit * 2)
            )
            v_res = await db.execute(vector_query)
            vector_results = list(v_res.all())
    except Exception:
        # Fallback to keyword search if vector fails
        logger.exception("Vector search failed; falling back to keyword search")

    # 2. Keyword Search — every term must appear (in title, summary or content).
    terms = _search_terms(q)
    keyword_query = select(Post).where(Post.published.is_(True))
    for term in terms:
        pattern = _like_contains(term)
        keyword_query = keyword_query.where(
            Post.title.ilike(pattern, escape="\\")
            | Post.summary.ilike(pattern, escape="\\")
            | Post.content.ilike(pattern, escape="\\")
        )
    keyword_query = keyword_query.order_by(
        Post.created_at.desc(), Post.id.desc()
    ).limit(limit * 2)

    k_res = await db.execute(keyword_query)
    keyword_posts = k_res.scalars().all()

    # 3. Merge Results (keyed by post id, so a post appears once)
    results_map: dict[int, dict[str, Any]] = {}

    for post, relevance in vector_results:
        if relevance < min_relevance:
            continue
        score = float(relevance)
        if lang and post.language == lang:
            score += SEARCH_LANG_BOOST
        results_map[post.id] = {
            "post": post,
            "relevance": min(score, SEARCH_VECTOR_ONLY_CEILING),
        }

    phrase = " ".join(q.split()).casefold()
    for post in keyword_posts:
        score = SEARCH_KEYWORD_SCORE
        haystack = f"{post.title}\n{post.summary or ''}\n{post.content}".casefold()
        if len(terms) > 1 and phrase in " ".join(haystack.split()):
            score += SEARCH_PHRASE_BONUS
        if post.id in results_map:
            score += SEARCH_HYBRID_BONUS
        results_map[post.id] = {"post": post, "relevance": min(1.0, score)}

    # Highest relevance first; the requested language breaks ties, then the
    # newer id (deterministic order for equal scores).
    sorted_results = sorted(
        results_map.values(),
        key=lambda x: (x["relevance"], x["post"].language == lang, x["post"].id),
        reverse=True,
    )[:limit]

    return [
        {
            "id": item["post"].id,
            "title": item["post"].title,
            "slug": item["post"].slug,
            "summary": item["post"].summary,
            "image_url": item["post"].display_image_url,
            "posted_at": _iso(item["post"].posted_at),
            "relevance": item["relevance"],
            # Debugging info could be returned if needed, but keeping schema clean for now
        }
        for item in sorted_results
    ]


@router.get("/{slug}", response_model=PostResponse)
async def get_post(
    slug: str,
    db: AsyncSession = Depends(get_db),
    current_user: User | None = Depends(get_current_user_optional),
) -> PostResponse:
    """Get a single post by slug — with ``ETag``/``Last-Modified`` via the
    router's ``ConditionalGetRoute``."""
    result = await db.execute(select(Post).where(Post.slug == slug))
    post = result.scalar_one_or_none()

    if not post:
        raise HTTPException(status_code=404, detail="Post not found")

    # Check permissions for drafts
    if not post.published and (not current_user or not current_user.is_admin):
        raise HTTPException(status_code=404, detail="Post not found")

    return _to_post_response(post)


@router.post("", response_model=PostResponse)
async def create_post(
    post_data: PostCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_admin_user),
):
    """Create a new post with embedding."""
    # Generate embedding from title + content
    text_for_embedding = f"{post_data.title}\n\n{post_data.content}"
    embedding = await get_embedding(text_for_embedding)

    post = Post(
        title=post_data.title,
        slug=post_data.slug,
        content=post_data.content,
        summary=post_data.summary,
        image_url=post_data.image_url,
        language=post_data.language,
        published=post_data.published,
        tags=post_data.tags,
        embedding=embedding,
    )

    try:
        db.add(post)
        await db.commit()
    except Exception:
        await db.rollback()
        # Handle unique constraint on slug potentially
        import random

        post.slug = f"{post_data.slug}-{random.randint(1000, 9999)}"
        db.add(post)
        try:
            await db.commit()
            print("DEBUG: create_post retry commit success")
        except Exception as e2:
            print(f"DEBUG: create_post retry commit failed: {e2}")
            raise
    await db.refresh(post)

    return _to_post_response(post)


@router.get("/{slug}/similar", response_model=list[SimilarPostResponse])
async def get_similar_posts(
    slug: str,
    limit: int = 5,
    db: AsyncSession = Depends(get_db),
):
    """Find similar posts using vector similarity."""
    result = await db.execute(select(Post).where(Post.slug == slug))
    post = result.scalar_one_or_none()

    if not post:
        raise HTTPException(status_code=404, detail="Post not found")

    if post.embedding is None:
        return []

    # Find similar posts using cosine distance
    similar_query = (
        select(
            Post,
            Post.embedding.cosine_distance(post.embedding).label("distance"),
        )
        .where(Post.id != post.id)
        .where(Post.published.is_(True))
        .where(Post.language == post.language)
        .where(Post.embedding.isnot(None))
        .order_by("distance")
        .limit(limit)
    )

    result = await db.execute(similar_query)
    # State the row shape: SQLAlchemy 2.1.4's AsyncSession.execute overloads collapse
    # Select[Post, float] to Result[Post] (an upstream typing gap, the runtime rows are
    # (Post, distance) pairs), which made mypy reject the unpacking below.
    similar_posts = cast("Sequence[tuple[Post, float]]", result.all())

    return [
        SimilarPostResponse(
            id=p.id,
            title=p.title,
            slug=p.slug,
            summary=p.summary,
            image_url=p.display_image_url,
            similarity=1 - distance,  # Convert distance to similarity
            posted_at=_iso(p.posted_at),
        )
        for p, distance in similar_posts
    ]


@router.post("/suggest-details")
async def suggest_post_details_endpoint(
    request: PostDetailSuggestionRequest,
    current_user: User = Depends(get_current_admin_user),
):
    """Suggest title, slug, and/or summary for a post using AI."""
    from app.services.ai import suggest_field, suggest_post_details

    if not request.field or request.field == "all":
        return await suggest_post_details(request.content, current_user.gemini_api_key)

    return await suggest_field(
        request.content, request.field, current_user.gemini_api_key
    )


@router.post("/suggest-tags")
async def suggest_tags_endpoint(
    request: TagSuggestionRequest, current_user: User = Depends(get_current_admin_user)
):
    """Suggest tags for a post using AI."""
    from app.services.ai import suggest_tags

    tags = await suggest_tags(
        request.title, request.content, current_user.gemini_api_key
    )
    return {"tags": tags}


class PostGenerationRequest(BaseModel):
    topic: str
    keywords: list[str] = []
    language: str = "en"


@router.post("/generate", response_model=PostResponse)
async def generate_post_endpoint(
    request: PostGenerationRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_admin_user),
):
    """
    Generate a full blog post using AI and save it as a draft.
    """
    from app.services.ai import generate_full_post

    generated_data = await generate_full_post(
        topic=request.topic,
        keywords=request.keywords,
        language=request.language,
        user_api_key=current_user.gemini_api_key,
    )

    if not generated_data:
        raise HTTPException(status_code=500, detail="Failed to generate post content")

    # Create the post structure
    # We need to generate an embedding for it too

    title = generated_data.get("title", "Untitled Post")
    content = generated_data.get("content", "")
    slug = generated_data.get("slug", "")
    summary = generated_data.get("summary", "")
    tags = generated_data.get("tags", [])

    # Ensure slug is unique-ish? For now let DB handle unique constraint error or append timestamp
    # But usually user will edit it.

    text_for_embedding = f"{title}\n\n{content}"
    embedding = await get_embedding(text_for_embedding)

    post = Post(
        title=title,
        slug=slug,
        content=content,
        summary=summary,
        language=request.language,
        published=False,  # Draft by default
        tags=tags,
        embedding=embedding,
    )

    try:
        db.add(post)
        await db.commit()
        await db.refresh(post)
    except Exception as e:
        print(f"DEBUG: create_post exception caught: {e}")
        await db.rollback()
        # Handle unique constraint on slug potentially
        import random

        post.slug = f"{slug}-{random.randint(1000, 9999)}"
        db.add(post)
        try:
            await db.commit()
            print("DEBUG: create_post retry commit success")
        except Exception as e2:
            print(f"DEBUG: create_post retry commit failed: {e2}")
            raise
        await db.refresh(post)

    return _to_post_response(post)


@router.put("/{id:int}", response_model=PostResponse)
async def update_post_by_id(
    id: int,
    post_data: PostUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_admin_user),
):
    """Update a post by ID."""
    result = await db.execute(select(Post).where(Post.id == id))
    post = result.scalar_one_or_none()

    if not post:
        raise HTTPException(status_code=404, detail="Post not found")

    update_embedding = False
    if post_data.title is not None:
        post.title = post_data.title
        update_embedding = True
    if post_data.content is not None:
        post.content = post_data.content
        update_embedding = True
    if post_data.summary is not None:
        post.summary = post_data.summary
    if post_data.image_url is not None:
        post.image_url = post_data.image_url
    if post_data.language is not None:
        post.language = post_data.language
    if post_data.published is not None:
        post.published = post_data.published
    if post_data.tags is not None:
        post.tags = post_data.tags

    # Regenerate embedding if content changed
    if update_embedding:
        text_for_embedding = f"{post.title}\n\n{post.content}"
        post.embedding = await get_embedding(text_for_embedding)

    await db.commit()
    await db.refresh(post)

    return _to_post_response(post)


@router.delete("/{id:int}")
async def delete_post_by_id(
    id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_admin_user),
):
    """Delete a post by ID."""
    result = await db.execute(select(Post).where(Post.id == id))
    post = result.scalar_one_or_none()

    if not post:
        raise HTTPException(status_code=404, detail="Post not found")

    await db.delete(post)
    await db.commit()

    return {"message": "Post deleted"}


@router.put("/{post_id}/image", response_model=PostResponse)
async def upload_post_image(
    post_id: int,
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_admin_user),
):
    """
    Upload an image for a blog post.
    """
    result = await db.execute(select(Post).where(Post.id == post_id))
    post = result.scalar_one_or_none()

    if not post:
        raise HTTPException(status_code=404, detail="Post not found")

    # Read file content
    content = await file.read()

    # Update post
    post.image_blob = content
    post.image_type = file.content_type

    # Clear external URL if a file is uploaded
    post.image_url = None

    await db.commit()
    await db.refresh(post)
    return _to_post_response(post)


@router.get("/{post_id}/image")
async def get_post_image(
    post_id: int,
    db: AsyncSession = Depends(get_db),
):
    """
    Get the image for a blog post.
    """
    from sqlalchemy.orm import undefer

    result = await db.execute(
        select(Post).options(undefer(Post.image_blob)).where(Post.id == post_id)
    )
    post = result.scalar_one_or_none()

    if not post or not post.image_blob:
        raise HTTPException(status_code=404, detail="Image not found")

    from io import BytesIO

    from starlette.responses import StreamingResponse

    return StreamingResponse(
        BytesIO(post.image_blob), media_type=post.image_type or "image/jpeg"
    )
