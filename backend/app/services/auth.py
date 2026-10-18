import secrets
from datetime import UTC, datetime, timedelta

import bcrypt
import jwt
from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import INSECURE_JWT_SECRET_KEYS, settings
from app.database import get_db
from app.logger import get_logger
from app.models.user import User

logger = get_logger(__name__)

# OAuth2 scheme for token extraction
oauth2_scheme = OAuth2PasswordBearer(tokenUrl=f"{settings.api_prefix}/auth/login")
oauth2_scheme_optional = OAuth2PasswordBearer(
    tokenUrl=f"{settings.api_prefix}/auth/login", auto_error=False
)


class InsecureJwtSecretError(RuntimeError):
    """Raised when no acceptable JWT signing secret is configured.

    SECURITY (issue #177): signing admin tokens with the committed placeholder
    secret lets anyone forge an admin token, so this is a hard failure rather
    than a warning — the app refuses to start (see ``app.main`` lifespan).
    """


# Random per-process secret used only when JWT_ALLOW_EPHEMERAL_SECRET is on
# (local dev / E2E). Cached so all tokens issued by this process verify.
_ephemeral_jwt_secret_key: str | None = None


def get_jwt_secret_key() -> str:
    """Return the secret used to sign/verify JWTs, refusing insecure values.

    Resolution order (issue #177):

    1. An explicitly configured ``JWT_SECRET_KEY`` that is not a known-insecure
       placeholder — the only accepted production configuration.
    2. Otherwise, when ``JWT_ALLOW_EPHEMERAL_SECRET`` is enabled (local dev /
       E2E only), a random per-process secret: tokens stay unforgeable and no
       key has to be committed or injected into CI, at the cost of sessions not
       surviving a restart.
    3. Otherwise, raise :class:`InsecureJwtSecretError`.
    """
    global _ephemeral_jwt_secret_key

    configured = settings.jwt_secret_key
    if configured not in INSECURE_JWT_SECRET_KEYS:
        return configured

    if settings.jwt_allow_ephemeral_secret:
        if _ephemeral_jwt_secret_key is None:
            _ephemeral_jwt_secret_key = secrets.token_hex(32)
            logger.warning(
                "JWT_SECRET_KEY is not set; using a random per-process signing "
                "secret (JWT_ALLOW_EPHEMERAL_SECRET is enabled). Sessions will "
                "not survive a restart — never rely on this in production."
            )
        return _ephemeral_jwt_secret_key

    raise InsecureJwtSecretError(
        "JWT_SECRET_KEY is unset or still the publicly-known placeholder. "
        "Refusing to sign admin tokens with a guessable secret. Set a strong "
        "value (generate one with 'openssl rand -hex 32'), or set "
        "JWT_ALLOW_EPHEMERAL_SECRET=true for local/E2E use only."
    )


def verify_password(plain_password: str, hashed_password: str) -> bool:
    """Verify a password against its hash."""
    return bcrypt.checkpw(
        plain_password.encode("utf-8"), hashed_password.encode("utf-8")
    )


def get_password_hash(password: str) -> str:
    """Hash a password using bcrypt."""
    # Use newer bcrypt API if available, but staying compatible with current code
    salt = bcrypt.gensalt()
    hashed = bcrypt.hashpw(password.encode("utf-8"), salt)
    return hashed.decode("utf-8")


def create_access_token(data: dict, expires_delta: timedelta | None = None) -> str:
    """Create a JWT access token."""
    to_encode = data.copy()
    now = datetime.now(UTC)
    if expires_delta:
        expire = now + expires_delta
    else:
        expire = now + timedelta(minutes=settings.jwt_expiration_minutes)

    to_encode.update({"exp": expire})
    encoded_jwt = jwt.encode(
        to_encode, get_jwt_secret_key(), algorithm=settings.jwt_algorithm
    )
    return encoded_jwt


def decode_access_token(token: str) -> dict | None:
    """Decode and validate a JWT token."""
    try:
        payload = jwt.decode(
            token, get_jwt_secret_key(), algorithms=[settings.jwt_algorithm]
        )
        return payload
    except jwt.PyJWTError as e:
        logger.warning(f"JWT decode error: {e}")
        return None


async def get_current_user(
    token: str = Depends(oauth2_scheme), db: AsyncSession = Depends(get_db)
) -> User:
    """Get the current authenticated user from JWT token."""
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )

    payload = decode_access_token(token)
    if payload is None:
        raise credentials_exception

    username: str | None = payload.get("sub")
    if username is None:
        raise credentials_exception

    result = await db.execute(select(User).where(User.username == username))
    user = result.scalar_one_or_none()

    if user is None:
        raise credentials_exception

    if not user.is_active:
        raise HTTPException(status_code=400, detail="Inactive user")

    return user


async def get_current_user_optional(
    token: str | None = Depends(oauth2_scheme_optional),
    db: AsyncSession = Depends(get_db),
) -> User | None:
    """Get the current authenticated user from JWT token, if present."""
    if not token:
        return None

    payload = decode_access_token(token)
    if payload is None:
        return None

    username: str | None = payload.get("sub")
    if username is None:
        return None

    result = await db.execute(select(User).where(User.username == username))
    user = result.scalar_one_or_none()

    if user is None or not user.is_active:
        return None

    return user


async def get_current_admin_user(
    current_user: User = Depends(get_current_user),
) -> User:
    """Verify that the current user has admin privileges."""
    if not current_user.is_admin:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail="Not enough permissions"
        )
    return current_user
