from unittest.mock import AsyncMock, patch

import pytest
from sqlalchemy.future import select

from app.config import settings
from app.models.cv_request import CvRequest


@pytest.mark.asyncio
async def test_cv_request_success(client, db_session):
    # Ensure active CV exists for versioning
    import uuid

    from app.models.cv_document import CvDocument

    doc = CvDocument(
        id=uuid.uuid4(),
        filename="test.pdf",
        data=b"pdf",
        version="v1.2",
        is_active=True,
    )
    db_session.add(doc)
    await db_session.commit()

    with patch(
        "app.api.cv.process_email_notifications", new_callable=AsyncMock
    ) as mock_emails:
        payload = {
            "name": "Recruiter One",
            "email": "recruiter@example.com",
            "company": "Big Tech",
            "message": "Interested in your profile.",
        }
        response = await client.post(f"{settings.api_prefix}/cv/request", json=payload)

        assert response.status_code == 200
        data = response.json()
        assert data["success"] is True
        assert f"{settings.api_prefix}/cv/download" in data["download_url"]

        # Check DB
        result = await db_session.execute(
            select(CvRequest).where(CvRequest.email == "recruiter@example.com")
        )
        cv_req = result.scalar_one_or_none()
        assert cv_req is not None
        assert cv_req.name == "Recruiter One"
        assert cv_req.cv_version == "v1.2"

        # Check background task was requested (mocked)
        mock_emails.assert_called_once()


@pytest.mark.asyncio
async def test_cv_request_validation_error(client):
    payload = {
        "name": "Recruiter Two",
        # Missing email
        "company": "Startup",
        "message": "Valid message",
    }
    response = await client.post(f"{settings.api_prefix}/cv/request", json=payload)
    assert response.status_code == 422


@pytest.mark.asyncio
async def test_cv_request_short_message_422(client):
    payload = {
        "name": "Short Msg",
        "email": "short@example.com",
        "message": "123",  # Too short (min 5)
    }
    response = await client.post(f"{settings.api_prefix}/cv/request", json=payload)
    assert response.status_code == 422


@pytest.mark.asyncio
async def test_cv_request_no_cv_available_404(client, db_session):
    # Ensure no CV document in DB
    payload = {
        "name": "Fail",
        "email": "fail@example.com",
        "message": "Valid message length",
    }
    response = await client.post(f"{settings.api_prefix}/cv/request", json=payload)
    assert response.status_code == 404
    assert "CV_ERROR_UNAVAILABLE" == response.json()["detail"]


@pytest.mark.asyncio
async def test_download_cv_not_found(client, db_session):
    # No CV in DB
    response = await client.get(f"{settings.api_prefix}/cv/download")
    assert response.status_code == 404
    assert response.json()["detail"] == "CV_ERROR_UNAVAILABLE"


@pytest.mark.asyncio
async def test_download_cv_db_success(client, db_session):
    # Add a document to DB
    import uuid

    from app.models.cv_document import CvDocument

    doc = CvDocument(
        id=uuid.uuid4(),
        filename="test.pdf",
        data=b"db pdf content",
        version="v1.0",
        is_active=True,
    )
    db_session.add(doc)
    await db_session.commit()

    response = await client.get(f"{settings.api_prefix}/cv/download")
    assert response.status_code == 200
    assert response.content == b"db pdf content"


@pytest.mark.asyncio
async def test_download_cv_with_tracking(client, db_session):
    # Setup CV and Request
    import uuid

    from app.models.cv_document import CvDocument
    from app.models.cv_request import CvRequest

    doc = CvDocument(
        id=uuid.uuid4(),
        filename="track.pdf",
        data=b"pdf data",
        version="v1.3",
        is_active=True,
    )
    db_session.add(doc)

    req_id = uuid.uuid4()
    req = CvRequest(
        id=req_id,
        name="Tracker",
        email="track@example.com",
        message="Tracking test",
        cv_version="v1.3",
        consent_given=True,
    )
    db_session.add(req)
    await db_session.commit()

    # Download with req_id
    response = await client.get(f"{settings.api_prefix}/cv/download?req_id={req_id!s}")
    assert response.status_code == 200
    assert response.content == b"pdf data"

    # Verify tracking
    # Start a new transaction/session to ensure we see the update
    # Note: In pytest-asyncio with shared session, refresh should work if commit happened.
    # We might need to handle session expiry or isolation depending on fixture.
    # Assuming 'db_session' fixture commits or flushes correctly.

    # Re-fetch from DB
    result = await db_session.execute(select(CvRequest).where(CvRequest.id == req_id))
    updated_req = result.scalar_one()

    assert updated_req.download_count == 1
    assert updated_req.downloaded_at is not None


@pytest.mark.asyncio
async def test_concurrent_downloads_count_every_single_one(client, db_session):
    """#326: `download_count` is incremented by the DATABASE, not in Python.

    The previous `cv_request.download_count += 1` computed the new value from a
    value read earlier, so simultaneous downloads of the same link all read N
    and all wrote N+1. MEASURED against the unfixed endpoint with analytics
    OFF (so no pool pressure at all — 1.5 s, zero errors): 300 downloads at
    concurrency 60 left download_count at **3**. Ten concurrent downloads here
    must count ten, and emit ten events.
    """
    import asyncio
    import uuid

    from httpx import ASGITransport, AsyncClient

    from app.database import get_db
    from app.main import app
    from app.models.cv_document import CvDocument
    from app.models.engagement_event import EngagementEvent
    from conftest import get_test_async_session

    db_session.add(
        CvDocument(
            id=uuid.uuid4(),
            filename="hot.pdf",
            data=b"pdf data",
            version="v9.9",
            is_active=True,
        )
    )
    req_id = uuid.uuid4()
    db_session.add(
        CvRequest(
            id=req_id,
            name="Hot Link",
            email="hot@example.com",
            message="shared with the whole team",
            consent_given=True,
        )
    )
    await db_session.commit()

    # Concurrency needs a session PER request; the shared `client` fixture
    # hands every request the same one, which cannot overlap.
    maker = get_test_async_session()

    async def fresh_session():
        async with maker() as session:
            yield session

    app.dependency_overrides[get_db] = fresh_session
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as concurrent:
        responses = await asyncio.gather(
            *(
                concurrent.get(f"{settings.api_prefix}/cv/download?req_id={req_id!s}")
                for _ in range(10)
            )
        )
    assert [r.status_code for r in responses] == [200] * 10

    async with maker() as verify:
        count = (
            await verify.execute(select(CvRequest).where(CvRequest.id == req_id))
        ).scalar_one()
        events = (
            (
                await verify.execute(
                    select(EngagementEvent).where(EngagementEvent.kind == "cv_download")
                )
            )
            .scalars()
            .all()
        )
    assert count.download_count == 10
    assert len(events) == 10


@pytest.mark.asyncio
async def test_download_cv_with_invalid_req_id(client, db_session):
    import uuid

    from app.models.cv_document import CvDocument

    doc = CvDocument(
        id=uuid.uuid4(),
        filename="track.pdf",
        data=b"pdf data",
        version="v1.3",
        is_active=True,
    )
    db_session.add(doc)
    await db_session.commit()

    invalid_id = uuid.uuid4()
    response = await client.get(
        f"{settings.api_prefix}/cv/download?req_id={invalid_id!s}"
    )
    assert response.status_code == 200
    assert response.content == b"pdf data"


@pytest.mark.asyncio
async def test_process_email_notifications_calls_both(db_session):
    import uuid

    from app.api.cv import process_email_notifications

    mock_payload = AsyncMock()
    mock_payload.name = "Test"
    mock_payload.email = "test@example.com"
    mock_payload.company = "Co"
    mock_payload.message = "Msg"

    with (
        patch("app.api.cv.email_service.send_cv_request_notification") as mock_admin,
        patch("app.api.cv.email_service.send_requester_confirmation") as mock_user,
    ):
        await process_email_notifications(uuid.uuid4(), mock_payload)
        mock_admin.assert_called_once()
        mock_user.assert_called_once()


@pytest.mark.asyncio
async def test_cv_request_exception(client):
    with patch("app.api.cv.select", side_effect=Exception("DB Error")):
        payload = {
            "name": "Recruiter Three",
            "email": "recruiter@example.com",
            "message": "Valid message long",
        }
        response = await client.post(f"{settings.api_prefix}/cv/request", json=payload)

        assert response.status_code == 500
        assert response.json()["detail"] == "Failed to process request"


@pytest.mark.asyncio
async def test_download_cv_exception(client):
    with patch("app.api.cv.select", side_effect=Exception("DB Error")):
        response = await client.get(f"{settings.api_prefix}/cv/download")
        assert response.status_code == 500
