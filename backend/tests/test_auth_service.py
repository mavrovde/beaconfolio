from datetime import timedelta
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import HTTPException

from app.models.user import User
from app.services.auth import (
    create_access_token,
    decode_access_token,
    get_current_admin_user,
    get_current_user,
    get_current_user_optional,
    get_password_hash,
    verify_password,
)


def test_password_hashing():
    pwd = "secret"
    hashed = get_password_hash(pwd)
    assert verify_password(pwd, hashed)
    assert not verify_password("wrong", hashed)


def test_token_operations():
    data = {"sub": "testuser"}
    token = create_access_token(data, expires_delta=timedelta(minutes=5))
    decoded = decode_access_token(token)
    assert decoded["sub"] == "testuser"

    # Test invalid token
    assert decode_access_token("invalid") is None

    # Test expired token logic (mocking time? or just setting negative delta)
    token_exp = create_access_token(data, expires_delta=timedelta(minutes=-5))
    # decode_access_token doesn't check expiry explicitly, jwt.decode does if verify_exp=True (default)
    # It raises PyJWTError which decode_access_token catches and returns None
    assert decode_access_token(token_exp) is None


@pytest.mark.asyncio
async def test_get_current_user():
    # Mock decode_access_token to return valid payload
    with patch("app.services.auth.decode_access_token", return_value={"sub": "admin"}):
        mock_db = MagicMock()
        mock_db.execute = AsyncMock()  # Fix: Make execute async
        mock_result = MagicMock()
        mock_user = User(username="admin", is_active=True, is_admin=True)
        mock_result.scalar_one_or_none.return_value = mock_user
        mock_db.execute.return_value = mock_result

        user = await get_current_user("token", mock_db)
        assert user.username == "admin"

    # Test user not found
    with patch(
        "app.services.auth.decode_access_token", return_value={"sub": "unknown"}
    ):
        mock_db = MagicMock()
        mock_db.execute = AsyncMock()  # Fix
        mock_result = MagicMock()
        mock_result.scalar_one_or_none.return_value = None
        mock_db.execute.return_value = mock_result

        with pytest.raises(HTTPException) as exc:
            await get_current_user("token", mock_db)
        assert exc.value.status_code == 401

    # Test inactive user
    with patch(
        "app.services.auth.decode_access_token", return_value={"sub": "inactive"}
    ):
        mock_db = MagicMock()
        mock_db.execute = AsyncMock()  # Fix
        mock_result = MagicMock()
        mock_user = User(username="inactive", is_active=False)
        mock_result.scalar_one_or_none.return_value = mock_user
        mock_db.execute.return_value = mock_result

        with pytest.raises(HTTPException) as exc:
            await get_current_user("token", mock_db)
        assert exc.value.status_code == 400


@pytest.mark.asyncio
async def test_get_current_user_optional():
    # Test no token
    user = await get_current_user_optional(None, None)
    assert user is None

    # Test invalid token
    with patch("app.services.auth.decode_access_token", return_value=None):
        user = await get_current_user_optional("token", None)
        assert user is None

    # Test valid token but user not found
    with patch("app.services.auth.decode_access_token", return_value={"sub": "admin"}):
        mock_db = MagicMock()
        mock_db.execute = AsyncMock()  # Fix
        mock_result = MagicMock()
        mock_result.scalar_one_or_none.return_value = None
        mock_db.execute.return_value = mock_result

        user = await get_current_user_optional("token", mock_db)
        assert user is None


@pytest.mark.asyncio
async def test_get_current_admin_user():
    admin = User(username="admin", is_admin=True)
    user = User(username="user", is_admin=False)

    assert await get_current_admin_user(admin) == admin

    with pytest.raises(HTTPException) as exc:
        await get_current_admin_user(user)
    assert exc.value.status_code == 403
