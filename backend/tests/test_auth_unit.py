from datetime import timedelta

from app.services.auth import (
    create_access_token,
    decode_access_token,
    get_password_hash,
    verify_password,
)


def test_password_hashing():
    password = "secretpassword"
    hashed = get_password_hash(password)
    assert hashed != password
    assert verify_password(password, hashed)
    assert not verify_password("wrongpassword", hashed)


def test_access_token_creation_and_decoding():
    data = {"sub": "testuser", "admin": True}
    token = create_access_token(data)
    decoded = decode_access_token(token)
    assert decoded is not None
    assert decoded["sub"] == "testuser"
    assert decoded["admin"] is True
    assert "exp" in decoded


def test_access_token_expiration():
    data = {"sub": "testuser"}
    # Create token expiring immediately
    token = create_access_token(data, expires_delta=timedelta(seconds=-1))
    decoded = decode_access_token(token)
    # verify expiration logic depends on library, usually decode fails if expired?
    # jwt.decode raises ExpiredSignatureError if verify_exp=True (default)
    # Our decode_access_token catches PyJWTError and returns None
    assert decoded is None


def test_decode_invalid_token():
    assert decode_access_token("invalid.token.string") is None


def test_decode_rejects_unsigned_alg_none_token():
    """The dependency swap was driven by an algorithm-confusion advisory: the guard is the
    explicit `algorithms=[...]` allow-list, so an unsigned token must never validate."""
    import base64
    import json

    def b64(raw: dict) -> str:
        return base64.urlsafe_b64encode(json.dumps(raw).encode()).rstrip(b"=").decode()

    forged = (
        f"{b64({'alg': 'none', 'typ': 'JWT'})}.{b64({'sub': 'admin', 'admin': True})}."
    )
    assert decode_access_token(forged) is None


def test_decode_rejects_token_signed_with_a_non_allowed_algorithm():
    import jwt

    from app.services.auth import get_jwt_secret_key

    forged = jwt.encode(
        {"sub": "admin", "admin": True}, get_jwt_secret_key(), algorithm="HS512"
    )
    assert decode_access_token(forged) is None


def test_token_round_trip_keeps_claims():
    token = create_access_token({"sub": "testuser", "admin": True})
    decoded = decode_access_token(token)
    assert decoded is not None
    assert (
        decoded["sub"] == "testuser" and decoded["admin"] is True and "exp" in decoded
    )
