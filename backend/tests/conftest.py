from collections.abc import AsyncGenerator
from unittest.mock import AsyncMock

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.main import app


@pytest.fixture(scope="function")
async def clean_client(db_session: AsyncSession) -> AsyncGenerator[AsyncClient, None]:
    """Create a test client WITHOUT auth overrides."""

    async def override_get_db():
        yield db_session

    app.dependency_overrides[get_db] = override_get_db

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac

    app.dependency_overrides.clear()


@pytest.fixture
def mock_embedding():
    """Return a mock embedding vector (list of floats)."""
    return [0.1] * 768


@pytest.fixture(autouse=True)
def _reset_rate_limiters():
    """Reset in-memory rate-limiter state before and after every test.

    The limiters hold module-level state keyed by client IP; without this,
    request counts from one test would bleed into the next (all httpx
    ASGI-transport test requests share the same synthetic client IP), making
    tests order-dependent.
    """
    from app.services.rate_limit import reset_all_rate_limiters

    reset_all_rate_limiters()
    yield
    reset_all_rate_limiters()


@pytest.fixture(autouse=True)
def _reset_analytics_write_budget():
    """Reset the analytics write budget between tests (#326).

    The emit semaphore and the pending/dropped counters are module-level. Each
    test gets its own event loop, so a semaphore carrying waiters from a closed
    loop — or a leftover pending count — would make the next test's budget
    depend on the previous one's.
    """
    from app.services.engagement import reset_write_budget

    reset_write_budget()
    yield
    reset_write_budget()


@pytest.fixture(autouse=True)
def mock_embedding_global(mocker):
    """Global mock for embeddings to prevent external API calls during tests."""
    val = [0.1] * 768

    async def mock_get_embedding(*args, **kwargs):
        return val[:]

    # Patch the service and api imports
    mocker.patch(
        "app.services.embeddings.get_embedding", side_effect=mock_get_embedding
    )
    mocker.patch("app.api.posts.get_embedding", side_effect=mock_get_embedding)
    mocker.patch("app.api.linkedin.get_embedding", side_effect=mock_get_embedding)

    return mock_get_embedding


@pytest.fixture(autouse=True)
def _mock_translation_llm(request, monkeypatch):
    """Rule 10, suite-wide: EVERY contact/CV POST now schedules the #248
    translation task, so without this default mock every existing test that
    submits a form runs a REAL LLM generation — seconds of live Ollama per
    POST, and real billable Gemini requests the moment a developer has a key
    in the environment (#298 round 1, measured: 8 outbound calls to
    generativelanguage.googleapis.com from unrelated tests).

    The canned reply is 'already the owner's language' so unrelated tests see
    a quiet not_needed and no translated fields. Tests that exercise the real
    fallback fork opt out with @pytest.mark.real_llm_seam and mock the
    transports themselves; tests that mock `_generate` with `patch(...)`
    simply layer over this and need no marker."""
    if request.node.get_closest_marker("real_llm_seam"):
        yield
        return
    monkeypatch.setattr(
        "app.services.translation._generate",
        AsyncMock(return_value='{"language": "en", "translation": ""}'),
    )
    yield


@pytest.fixture(autouse=True)
def _redirect_background_sessions(monkeypatch):
    """Background tasks open their OWN session via app.database.async_session
    (#248's translation task is the first). The get_db override cannot reach
    them, so without this redirect a background task in a test writes to the
    DEV database — the exact isolation failure lessons §4 exists to prevent.
    Point the module-level factory at the test engine for every test."""
    import app.database
    from conftest import get_test_async_session

    monkeypatch.setattr(app.database, "async_session", get_test_async_session())
    # The analytics side-writes have their OWN pool (#326) and therefore their
    # own factory; it needs the same redirect or every emitted event in the
    # suite would land in the DEV database.
    monkeypatch.setattr(app.database, "analytics_session", get_test_async_session())
    # Modules that imported the name directly get the same redirect.
    import app.services.translation

    monkeypatch.setattr(
        app.services.translation, "async_session", get_test_async_session()
    )
