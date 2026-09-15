"""Voice channel (#264) through the COMPOSED stack (rule 12).

What this tier can see that the unit tier structurally cannot:

1. **The proxy hop.** nginx's default ``client_max_body_size`` is 1m — BELOW
   ``VOICE_MESSAGE_MAX_BYTES`` (2 MB) — so before this PR's
   ``proxy/default.conf.template`` change, a >1 MB recording never reached the
   app and the caller got nginx's opaque HTML 413 instead of the endpoint's
   ``{"detail": ...}``. A unit test cannot fail on that: there is no nginx in
   the ASGI transport. This is the layer that owns that assertion.
2. **A genuinely broken transcriber.** The overlay pins
   ``WHISPER_MODEL=inttest-no-such-model`` + ``HF_HUB_OFFLINE=1``, so the real
   background task runs against a model faster-whisper rejects in its own
   validation — no network attempt, no ~150 MB download in CI (measured:
   ``ValueError: Invalid model size ...``). That is issue #264's verify step 3
   ("break the transcriber → the message still lands and is playable") executed
   against the real stack rather than a monkeypatched loader.

Both voice POSTs here ride ``post_voice()``, which documents and spends the
endpoint's 3/60s budget — read its docstring before adding a poster.
"""

import time

import httpx

from conftest import API, PUBLIC_URL, post_voice

# EBML magic + filler: the endpoint stores whatever the browser sent and the
# transcriber is broken on purpose here, so the bytes only have to round-trip.
WEBM = b"\x1a\x45\xdf\xa3" + b"inttest-opus-payload" * 8


def _poll_transcription(
    client: httpx.Client,
    headers: dict[str, str],
    interaction_id: str,
    timeout_s: float = 20.0,
) -> dict:
    """Transcription is a background task; poll the admin row until it settles."""
    deadline = time.monotonic() + timeout_s
    row: dict = {}
    while time.monotonic() < deadline:
        page = client.get(
            f"{API}/admin/interactions?page_size=50", headers=headers
        ).json()
        row = next(i for i in page["items"] if i["id"] == interaction_id)
        if (row.get("payload") or {}).get("transcription") != "pending":
            return row
        time.sleep(0.5)
    return row


def test_a_broken_transcriber_never_breaks_intake(client, admin_headers):
    """#264 verify step 3, composed: the row lands, the audio stays playable."""
    created = post_voice(client, WEBM, duration_s="14.5", name="Vera Voice")
    assert created.status_code == 201, created.text
    body = created.json()
    interaction_id = body["id"]
    assert body["source"] == "voice_message"
    assert body["payload"]["transcription"] == "pending"
    assert body["payload"]["size_bytes"] == len(WEBM)

    # The real background task ran with an unloadable model, offline.
    row = _poll_transcription(client, admin_headers, interaction_id)
    assert row["payload"]["transcription"] == "failed", row
    # Intake is intact: the interaction is still in the inbox, still `new`, and
    # nothing about the failure touched the audio.
    assert row["status"] == "new"
    assert row["name"] == "Vera Voice"

    audio = client.get(
        f"{API}/admin/interactions/{interaction_id}/voice", headers=admin_headers
    )
    assert audio.status_code == 200, audio.text
    assert audio.content == WEBM
    assert audio.headers["content-type"] == "audio/webm"
    assert "inline" in audio.headers["content-disposition"]

    # Anonymous playback is refused — a recruiter's voice is not public.
    anon = client.get(f"{API}/admin/interactions/{interaction_id}/voice")
    assert anon.status_code == 401, anon.text


def test_the_proxy_does_not_shadow_the_endpoints_own_size_cap(client):
    """A >1 MB body must reach the APP, so the app's 413 is what callers see.

    Mutation-check for the proxy change: drop `client_max_body_size` from
    proxy/default.conf.template and nginx answers 413 with an HTML body and no
    `detail` key, so the JSON assertion below fails. A ~90s Opus recording is
    ~1.1 MB, i.e. inside the app's cap but over nginx's default — this is the
    case that would have rejected real voice messages in production.
    """
    oversize = WEBM + b"\x00" * (2 * 1024 * 1024)  # > VOICE_MESSAGE_MAX_BYTES
    resp = post_voice(client, oversize, duration_s="80")
    assert resp.status_code == 413, resp.text
    # nginx's own 413 is text/html; the app's is JSON with a detail message.
    assert resp.headers["content-type"].startswith("application/json"), resp.text
    assert "MB limit" in resp.json()["detail"], resp.text


def test_the_public_voice_endpoint_is_rate_limited(client):
    """#264 verify step 2 (second half), composed: hammering it yields 429.

    The two tests above spent two of the three slots in the window; this one
    walks off the end deliberately, so it uses the raw client instead of
    `post_voice()` (which would absorb the 429 it is here to observe).
    """
    url = f"{PUBLIC_URL}/api/app/interactions/voice"
    seen = []
    for _ in range(3):
        resp = client.post(
            url,
            files={"audio": ("note.webm", WEBM, "audio/webm")},
            data={"duration_s": "3"},
            headers={"Host": "localhost"},
        )
        seen.append(resp.status_code)
        if resp.status_code == 429:
            break
    assert 429 in seen, f"expected a 429 within the budget, saw {seen}"
