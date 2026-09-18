"""Black-box integration tier (#260).

These tests hit a RUNNING stack over real HTTP — no ASGI transport, no
monkeypatching. Bring it up with `./run_integration_tests.sh` (which boots
docker-compose.yml + docker-compose.inttest.yml, where the `ollama` service is
WireMock). This directory is deliberately OUTSIDE `backend/tests/` so the unit
run (`pytest` with testpaths=["tests"]) never collects it, and vice versa.

Environment:
  BACKEND_URL  direct backend origin        (default http://localhost:8000)
  PUBLIC_URL   through the reverse proxy    (default http://localhost:4200)
  E2E creds    seeded by scripts/seed_e2e_user.py (admin / admin123)
"""

import os
import time

import httpx
import pytest

BACKEND_URL = os.environ.get("BACKEND_URL", "http://localhost:8000").rstrip("/")
PUBLIC_URL = os.environ.get("PUBLIC_URL", "http://localhost:4200").rstrip("/")
API = f"{BACKEND_URL}/api/app"


@pytest.fixture(scope="session")
def client() -> httpx.Client:
    with httpx.Client(timeout=30.0) as c:
        yield c


@pytest.fixture(scope="session")
def admin_token(client: httpx.Client) -> str:
    # OAuth2PasswordRequestForm: FORM-encoded, not JSON.
    resp = client.post(
        f"{API}/auth/login",
        data={"username": "admin", "password": "admin123"},
    )
    assert resp.status_code == 200, (
        f"admin login failed ({resp.status_code}): run scripts/seed_e2e_user.py "
        "inside the backend container first (run_integration_tests.sh does)."
    )
    return resp.json()["access_token"]


@pytest.fixture(scope="session")
def admin_headers(admin_token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {admin_token}"}


def post_contact(client: httpx.Client, payload: dict) -> httpx.Response:
    """POST the public contact form, absorbing the 5/60s rate limit.

    RATE-LIMIT BUDGET (#296 round 2, re-hit by #298 round 2): the tier posts
    FIVE contacts per full run — exactly the budget — so a back-to-back local
    re-run starts inside a saturated window. Every contact-posting test rides
    a 429 retry — this helper, or the equivalent loop the mailpit test keeps
    inline (it breaks out on the first non-429 and asserts once, after the
    loop): the sliding window frees a slot 60s after the hit that took it, so
    a partial wait cannot clear it.
    """
    resp = client.post(f"{API}/interactions/contact", json=payload)
    for _ in range(3):
        if resp.status_code != 429:
            break
        time.sleep(61)
        resp = client.post(f"{API}/interactions/contact", json=payload)
    return resp


def post_voice(
    client: httpx.Client,
    audio: bytes,
    *,
    duration_s: str = "12.5",
    content_type: str = "audio/webm",
    **fields: str,
) -> httpx.Response:
    """POST a voice message THROUGH THE PROXY, absorbing the 3/60s limit.

    RATE-LIMIT BUDGET (#264): the voice endpoint's own budget is
    VOICE_RATE_LIMIT_REQUESTS=3 per 60s — tighter than the contact form's 5,
    because one call writes TWO rows and schedules a transcription. The tier
    spends it as: one accepted message, one oversize rejection (a rejection
    still costs a slot — the limiter is a route dependency, so it runs before
    the handler), and then the rate-limit case deliberately walks off the end.
    Count the slots before adding a poster here.

    Every voice request goes through PUBLIC_URL, never BACKEND_URL: the proxy
    is part of this endpoint's contract (nginx's default body limit is BELOW
    the app's cap — see proxy/default.conf.template), and mixing the two
    origins would also split the limiter's per-IP key and make the budget
    unreadable.
    """
    url = f"{PUBLIC_URL}/api/app/interactions/voice"
    headers = {"Host": "localhost"}
    files = {"audio": ("note.webm", audio, content_type)}
    data = {"duration_s": duration_s, **fields}
    resp = client.post(url, files=files, data=data, headers=headers)
    for _ in range(3):
        if resp.status_code != 429:
            break
        time.sleep(61)
        resp = client.post(url, files=files, data=data, headers=headers)
    return resp
