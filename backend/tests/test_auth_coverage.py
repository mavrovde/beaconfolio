from datetime import timedelta
from unittest.mock import MagicMock, patch

import pytest
from fastapi import HTTPException
from jwt import PyJWTError
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.models.user import User
from app.services.auth import (
    create_access_token,
    decode_access_token,
    get_current_admin_user,
    get_current_user,
    get_current_user_optional,
    get_password_hash,
)

# --- Integration Tests for API Edge Cases ---


@pytest.mark.asyncio
async def test_login_inactive_user(client, db_session):
    password = "testpassword"
    hashed = get_password_hash(password)
    user = User(
        username="inactiveuser",
        email="inactive@example.com",
        hashed_password=hashed,
        is_active=False,
        is_admin=False,
    )
    db_session.add(user)
    await db_session.commit()

    response = await client.post(
        f"{settings.api_prefix}/auth/login",
        data={"username": "inactiveuser", "password": password},
        headers={"Content-Type": "application/x-www-form-urlencoded"},
    )

    assert response.status_code == 400
    assert response.json()["detail"] == "Inactive user"


# --- Unit Tests for Service Layer ---


@pytest.mark.asyncio
async def test_get_current_user_invalid_token():
    # Mock decode_access_token to return None (simulating JWTError inside it if implemented that way,
    # or just Mocking the function directly if possible.
    # Actually, let's call get_current_user with an invalid string and rely on real decode logic if we want,
    # OR better: mock decode_access_token to fail.

    with patch("app.services.auth.decode_access_token", return_value=None):
        db = MagicMock(spec=AsyncSession)
        with pytest.raises(HTTPException) as exc:
            await get_current_user(token="invalid", db=db)
        assert exc.value.status_code == 401
        assert exc.value.detail == "Could not validate credentials"


@pytest.mark.asyncio
async def test_get_current_user_missing_sub():
    with patch(
        "app.services.auth.decode_access_token", return_value={"other": "claim"}
    ):
        db = MagicMock(spec=AsyncSession)
        with pytest.raises(HTTPException) as exc:
            await get_current_user(token="valid_format_no_sub", db=db)
        assert exc.value.status_code == 401


@pytest.mark.asyncio
async def test_get_current_user_not_found(db_session):
    # Prepare token for non-existent user
    token = create_access_token(data={"sub": "ghost"})

    # We use real DB session but user is not in it
    with pytest.raises(HTTPException) as exc:
        await get_current_user(token=token, db=db_session)
    assert exc.value.status_code == 401


@pytest.mark.asyncio
async def test_get_current_user_inactive(db_session):
    # Create inactive user
    user = User(
        username="lazy",
        email="lazy@example.com",
        hashed_password="hash",
        is_active=False,
    )
    db_session.add(user)
    await db_session.commit()

    token = create_access_token(data={"sub": "lazy"})

    with pytest.raises(HTTPException) as exc:
        await get_current_user(token=token, db=db_session)
    assert exc.value.status_code == 400
    assert exc.value.detail == "Inactive user"


@pytest.mark.asyncio
async def test_get_current_admin_user_not_admin():
    user = User(username="normie", is_admin=False)
    with pytest.raises(HTTPException) as exc:
        await get_current_admin_user(current_user=user)
    assert exc.value.status_code == 403
    assert exc.value.detail == "Not enough permissions"


@pytest.mark.asyncio
async def test_get_current_admin_user_success():
    user = User(username="boss", is_admin=True)
    result = await get_current_admin_user(current_user=user)
    assert result == user


@pytest.mark.asyncio
async def test_get_current_user_optional_none(db_session):
    # No token
    result = await get_current_user_optional(token=None, db=db_session)
    assert result is None


@pytest.mark.asyncio
async def test_get_current_user_optional_invalid(db_session):
    # Invalid token should return None, not raise
    with patch("app.services.auth.decode_access_token", return_value=None):
        result = await get_current_user_optional(token="invalid", db=db_session)
        assert result is None


@pytest.mark.asyncio
async def test_get_current_user_optional_inactive(db_session):
    user = User(username="ghost", is_active=False)
    db_session.add(user)
    # We mock payload decode to return ghost
    with patch("app.services.auth.decode_access_token", return_value={"sub": "ghost"}):
        # We need the select to find the user. db_session.add(user) + commit is needed?
        # Since we use real session in test (but maybe empty DB), we need to ensure select works.
        # Actually mocked session/queries is complex here.
        # Let's rely on the fact that if we insert user into session it *might* be found if we commit?
        # Or better: Mock db.execute.

        # Simulating db.execute returning user
        db = MagicMock(spec=AsyncSession)
        result_mock = MagicMock()
        result_mock.scalar_one_or_none.return_value = user
        db.execute.return_value = result_mock

        result = await get_current_user_optional(token="token", db=db)
        assert result is None  # Inactive user returns None


@pytest.mark.asyncio
async def test_create_access_token_with_delta():
    delta = timedelta(minutes=15)
    token = create_access_token(data={"sub": "test"}, expires_delta=delta)
    assert token is not None


@pytest.mark.asyncio
async def test_decode_access_token_error():
    with patch("jwt.decode", side_effect=PyJWTError("Invalid token")):
        result = decode_access_token("some_token")
        assert result is None


@pytest.mark.asyncio
async def test_get_current_user_success(db_session):
    user = User(
        username="validuser",
        email="valid@example.com",
        hashed_password=get_password_hash("password"),
    )
    db_session.add(user)
    await db_session.commit()
    token = create_access_token(data={"sub": "validuser"})
    result = await get_current_user(token=token, db=db_session)
    assert result.username == "validuser"


@pytest.mark.asyncio
async def test_get_current_user_optional_missing_sub():
    with patch("app.services.auth.decode_access_token", return_value={"no": "sub"}):
        db = MagicMock(spec=AsyncSession)
        result = await get_current_user_optional(token="token", db=db)
        assert result is None


@pytest.mark.asyncio
async def test_get_current_user_optional_success(db_session):
    user = User(
        username="optionaluser",
        email="optional@example.com",
        hashed_password=get_password_hash("password"),
    )
    db_session.add(user)
    await db_session.commit()
    token = create_access_token(data={"sub": "optionaluser"})
    result = await get_current_user_optional(token=token, db=db_session)
    assert result.username == "optionaluser"
