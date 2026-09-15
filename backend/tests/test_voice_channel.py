"""Voice channel tests (#264) — public intake, local transcription, playback.

Every test here mocks the Whisper boundary. Nothing in this file (or anywhere
in the suite: see `tests/conftest.py::_forbid_real_whisper_model`) may load a
real model, because that is a ~150 MB network download per CI job.
"""

import uuid
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest
from httpx import AsyncClient
from sqlalchemy import select

from app.config import settings
from app.models.interaction import Interaction
from app.models.voice_message import VoiceMessage

VOICE_URL = f"{settings.api_prefix}/interactions/voice"
ADMIN_URL = f"{settings.api_prefix}/admin/interactions"

# A plausible WebM/Matroska header. The bytes are never decoded in tests (the
# transcriber is mocked); they exist so the stored blob is not a placeholder
# string that could pass a weaker assertion than "the exact audio came back".
WEBM = b"\x1a\x45\xdf\xa3" + b"opus-payload" * 4


@pytest.fixture(autouse=True)
def _voice_enabled(monkeypatch):
    """The channel ships OFF (see `Settings.voice_messages_enabled`); these
    tests are about it being ON. The off-state is pinned explicitly below."""
    monkeypatch.setattr(settings, "voice_messages_enabled", True)


async def _post_voice(
    client: AsyncClient,
    *,
    audio: bytes = WEBM,
    content_type: str = "audio/webm",
    duration_s: object = 12.0,
    filename: str = "note.webm",
    **fields: object,
):
    data: dict[str, object] = {"duration_s": str(duration_s)}
    data.update(fields)
    return await client.post(
        VOICE_URL,
        files={"audio": (filename, audio, content_type)},
        data=data,
    )


def _fake_model(
    *, text: str = "Hello, we have a role for you.", duration=12.0, language="en"
):
    """A stand-in for `faster_whisper.WhisperModel` returning ONE segment."""
    model = MagicMock()
    model.transcribe.return_value = (
        iter([SimpleNamespace(text=f" {text} ")]),
        SimpleNamespace(duration=duration, language=language),
    )
    return model


def _install_model(monkeypatch, model) -> None:
    from app.services import transcription

    monkeypatch.setattr(transcription, "_load_model", lambda: model)


# --- intake ------------------------------------------------------------------


@pytest.mark.asyncio
async def test_voice_message_lands_in_the_inbox(
    client: AsyncClient, db_session, monkeypatch
):
    _install_model(monkeypatch, _fake_model())
    resp = await _post_voice(client, name="Rita Recruiter", email="rita@agency.example")
    assert resp.status_code == 201
    body = resp.json()
    assert body["source"] == "voice_message"
    assert body["status"] == "new"
    assert body["name"] == "Rita Recruiter"
    # The response is the INTAKE state: transcription is a background task, so
    # the payload says pending and the message is still empty at this point.
    assert body["payload"]["transcription"] == "pending"
    assert body["message"] == ""

    audio_rows = (await db_session.execute(select(VoiceMessage))).scalars().all()
    assert len(audio_rows) == 1
    assert audio_rows[0].data == WEBM
    assert audio_rows[0].size_bytes == len(WEBM)
    assert audio_rows[0].content_type == "audio/webm"
    assert audio_rows[0].claimed_duration_seconds == 12.0

    row = (await db_session.execute(select(Interaction))).scalars().one()
    # The hub row points at the audio the #69 way: source_ref, not a new column.
    assert row.source_ref == audio_rows[0].id
    assert row.payload["voice_message_id"] == str(audio_rows[0].id)
    assert row.payload["claimed_duration_s"] == 12.0
    assert row.payload["size_bytes"] == len(WEBM)


@pytest.mark.asyncio
async def test_voice_message_is_transcribed_into_the_message_field(
    client: AsyncClient, db_session, monkeypatch
):
    """The transcript becomes `Interaction.message` — not a payload-only extra —
    so the inbox list, promote-to-pipeline and #248's translation need no
    per-source special case."""
    _install_model(
        monkeypatch, _fake_model(text="We have a role for you.", language="en")
    )
    resp = await _post_voice(client)
    assert resp.status_code == 201

    row = await db_session.get(Interaction, uuid.UUID(resp.json()["id"]))
    await db_session.refresh(row)
    assert row.message == "We have a role for you."
    assert row.detected_language == "en"
    assert row.payload["transcription"] == "done"
    assert row.payload["transcription_model"] == settings.whisper_model
    assert row.payload["duration_s"] == 12.0
    assert row.payload["language"] == "en"


@pytest.mark.asyncio
async def test_anonymous_voice_message_gets_placeholder_identity(
    client: AsyncClient, monkeypatch
):
    """ "One tap for the recruiter": name/email are optional, unlike the contact
    form. The row still has to satisfy the NOT NULL columns."""
    _install_model(monkeypatch, _fake_model())
    resp = await _post_voice(client)
    assert resp.status_code == 201
    assert resp.json()["name"] == "Voice message"
    assert resp.json()["email"] == ""
    assert resp.json()["company"] is None


@pytest.mark.asyncio
async def test_blank_optional_fields_mean_absent(client: AsyncClient, monkeypatch):
    """A multipart form sends untouched inputs as "" — which must fall back to
    the anonymous defaults rather than fail EmailStr/min_length."""
    _install_model(monkeypatch, _fake_model())
    resp = await _post_voice(client, name="", email="", company="")
    assert resp.status_code == 201
    assert resp.json()["name"] == "Voice message"
    assert resp.json()["email"] == ""


@pytest.mark.asyncio
async def test_voice_folds_line_breaks_in_header_bound_fields(
    client: AsyncClient, monkeypatch
):
    """Same trap as the contact form (#69 round 1): a line break in `name`
    reaches the notification Subject and the stdlib refuses the whole email."""
    _install_model(monkeypatch, _fake_model())
    resp = await _post_voice(client, name="Eve\r\nBcc: spam@x", company="A\nB")
    assert resp.status_code == 201
    assert resp.json()["name"] == "Eve Bcc: spam@x"
    assert resp.json()["company"] == "A B"


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "fields",
    [
        {"name": "A"},  # below the 2-char floor
        {"name": "x" * 201},
        {"email": "not-an-email"},
        {"company": "x" * 201},
        {"duration_s": 0},
        {"duration_s": -3},
        {"duration_s": "abc"},
    ],
)
async def test_voice_validation_errors(client: AsyncClient, fields):
    resp = await _post_voice(client, **fields)
    assert resp.status_code == 422
    # FastAPI's own body-validation shape, not a second endpoint-specific one.
    assert resp.json()["detail"][0]["loc"][0] == "body"


@pytest.mark.asyncio
async def test_voice_requires_a_declared_duration(client: AsyncClient):
    resp = await client.post(
        VOICE_URL, files={"audio": ("note.webm", WEBM, "audio/webm")}
    )
    assert resp.status_code == 422


@pytest.mark.asyncio
@pytest.mark.parametrize("content_type", ["audio/mpeg", "application/pdf", ""])
async def test_voice_rejects_other_media_types(client: AsyncClient, content_type):
    resp = await _post_voice(client, content_type=content_type)
    assert resp.status_code == 415


@pytest.mark.asyncio
async def test_voice_accepts_ogg_and_codec_parameters(client: AsyncClient, monkeypatch):
    """MediaRecorder reports `audio/webm;codecs=opus`; matching the full string
    would reject every real browser upload."""
    _install_model(monkeypatch, _fake_model())
    assert (
        await _post_voice(client, content_type="audio/ogg;codecs=opus")
    ).status_code == 201
    assert (
        await _post_voice(client, content_type="audio/webm;codecs=opus")
    ).status_code == 201


@pytest.mark.asyncio
async def test_voice_rejects_an_oversized_upload(
    client: AsyncClient, db_session, monkeypatch
):
    """#264's verification step 2: a big file gets 413 and stores NOTHING."""
    monkeypatch.setattr(settings, "voice_message_max_bytes", 1024)
    resp = await _post_voice(client, audio=b"a" * 2048)
    assert resp.status_code == 413
    assert "MB limit" in resp.json()["detail"]
    assert (await db_session.execute(select(VoiceMessage))).scalars().all() == []
    assert (await db_session.execute(select(Interaction))).scalars().all() == []


@pytest.mark.asyncio
async def test_voice_accepts_an_upload_exactly_at_the_cap(
    client: AsyncClient, monkeypatch
):
    """The bounded read asks for max+1 bytes; an off-by-one there would reject
    a recording of exactly the documented size."""
    monkeypatch.setattr(settings, "voice_message_max_bytes", 1024)
    _install_model(monkeypatch, _fake_model())
    assert (await _post_voice(client, audio=b"a" * 1024)).status_code == 201


@pytest.mark.asyncio
async def test_voice_rejects_a_recording_longer_than_the_cap(
    client: AsyncClient, db_session
):
    resp = await _post_voice(client, duration_s=91)
    assert resp.status_code == 413
    assert "90s limit" in resp.json()["detail"]
    assert (await db_session.execute(select(VoiceMessage))).scalars().all() == []


@pytest.mark.asyncio
async def test_voice_rejects_an_empty_payload(client: AsyncClient):
    resp = await _post_voice(client, audio=b"")
    assert resp.status_code == 422
    assert resp.json()["detail"] == "Audio payload is empty."


@pytest.mark.asyncio
async def test_voice_rate_limited_after_limit(client: AsyncClient, monkeypatch):
    """#264's verification step 2, second half: hammering the endpoint gets
    429 — and the rejected requests create neither a row nor a notification."""
    from app.api import interactions as interactions_module

    _install_model(monkeypatch, _fake_model())
    monkeypatch.setattr(interactions_module.voice_rate_limiter, "max_requests", 2)
    with patch("app.api.interactions.notify_owner") as send:
        assert (await _post_voice(client)).status_code == 201
        assert (await _post_voice(client)).status_code == 201
        assert (await _post_voice(client)).status_code == 429
    assert send.call_count == 2


def test_voice_limiter_builds_from_settings(monkeypatch):
    """Pins the SETTINGS WIRING with sentinels (§25): comparing against the
    unmodified defaults would pass even if the code hardcoded 3/60."""
    from app.api.interactions import _build_voice_limiter

    monkeypatch.setattr(settings, "voice_rate_limit_requests", 11)
    monkeypatch.setattr(settings, "voice_rate_limit_window_seconds", 222)
    limiter = _build_voice_limiter()
    assert limiter.max_requests == 11
    assert limiter.window_seconds == 222


# --- the feature flag --------------------------------------------------------


@pytest.mark.asyncio
async def test_flag_off_means_the_endpoint_does_not_exist(
    client: AsyncClient, db_session, monkeypatch
):
    """#264: "Disable the flag → widget gone, endpoint 404"."""
    monkeypatch.setattr(settings, "voice_messages_enabled", False)
    resp = await _post_voice(client)
    assert resp.status_code == 404
    assert (await db_session.execute(select(VoiceMessage))).scalars().all() == []


@pytest.mark.asyncio
async def test_flag_off_wins_over_the_rate_limit(client: AsyncClient, monkeypatch):
    """Dependency ORDER: a disabled channel must not spend a caller's budget,
    so every request past the limit still answers 404, never 429."""
    from app.api import interactions as interactions_module

    monkeypatch.setattr(settings, "voice_messages_enabled", False)
    monkeypatch.setattr(interactions_module.voice_rate_limiter, "max_requests", 1)
    codes = [(await _post_voice(client)).status_code for _ in range(3)]
    assert codes == [404, 404, 404]


@pytest.mark.asyncio
async def test_flag_off_still_serves_already_received_audio(
    client: AsyncClient, db_session, monkeypatch
):
    """Turning intake off must not orphan recordings the owner already has —
    the flag governs SENDING, not the admin's access to what arrived."""
    _install_model(monkeypatch, _fake_model())
    interaction_id = (await _post_voice(client)).json()["id"]
    monkeypatch.setattr(settings, "voice_messages_enabled", False)
    resp = await client.get(f"{ADMIN_URL}/{interaction_id}/voice")
    assert resp.status_code == 200
    assert resp.content == WEBM


# --- admin playback ----------------------------------------------------------


@pytest.mark.asyncio
async def test_admin_can_play_the_audio_back(client: AsyncClient, monkeypatch):
    _install_model(monkeypatch, _fake_model())
    interaction_id = (await _post_voice(client)).json()["id"]
    resp = await client.get(f"{ADMIN_URL}/{interaction_id}/voice")
    assert resp.status_code == 200
    assert resp.content == WEBM
    assert resp.headers["content-type"] == "audio/webm"
    # `inline` is what makes <audio> play it instead of downloading it, and
    # `private` keeps recruiter audio out of every shared cache.
    assert resp.headers["content-disposition"].startswith("inline;")
    assert resp.headers["content-disposition"].endswith('.webm"')
    assert "private" in resp.headers["cache-control"]


@pytest.mark.asyncio
async def test_admin_playback_extension_follows_the_container(
    client: AsyncClient, monkeypatch
):
    _install_model(monkeypatch, _fake_model())
    interaction_id = (
        await _post_voice(client, content_type="audio/ogg", filename="note.ogg")
    ).json()["id"]
    resp = await client.get(f"{ADMIN_URL}/{interaction_id}/voice")
    assert resp.headers["content-type"] == "audio/ogg"
    assert resp.headers["content-disposition"].endswith('.ogg"')


@pytest.mark.asyncio
async def test_admin_playback_404s_for_an_unknown_interaction(client: AsyncClient):
    resp = await client.get(f"{ADMIN_URL}/{uuid.uuid4()}/voice")
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_admin_playback_404s_for_a_non_voice_interaction(
    client: AsyncClient, db_session
):
    interaction = Interaction(
        source="contact_form",
        status="new",
        name="Rita",
        email="rita@agency.example",
        message="Typed, not spoken.",
    )
    db_session.add(interaction)
    await db_session.commit()
    resp = await client.get(f"{ADMIN_URL}/{interaction.id}/voice")
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_admin_playback_404s_when_the_audio_row_is_gone(
    client: AsyncClient, db_session
):
    """`source_ref` is an FK-less pointer by #69's design, so a dangling one is
    reachable (a purge, a partially restored dump) — and must 404, not 500."""
    interaction = Interaction(
        source="voice_message",
        source_ref=uuid.uuid4(),
        status="new",
        name="Voice message",
        email="",
        message="",
    )
    db_session.add(interaction)
    await db_session.commit()
    resp = await client.get(f"{ADMIN_URL}/{interaction.id}/voice")
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_admin_playback_requires_authentication(clean_client: AsyncClient):
    """Recruiter audio is personal data: there is no unauthenticated route to it."""
    resp = await clean_client.get(f"{ADMIN_URL}/{uuid.uuid4()}/voice")
    assert resp.status_code in (401, 403)


@pytest.mark.asyncio
async def test_inbox_can_filter_by_the_new_source(client: AsyncClient, monkeypatch):
    """`voice_message` has to be in INTERACTION_SOURCES or the admin inbox
    rejects its own filter value with a 422."""
    _install_model(monkeypatch, _fake_model())
    assert (await _post_voice(client)).status_code == 201
    resp = await client.get(f"{ADMIN_URL}?source=voice_message")
    assert resp.status_code == 200
    assert resp.json()["total"] == 1
    assert resp.json()["items"][0]["source"] == "voice_message"


# --- owner notification (#263 registry) --------------------------------------


@pytest.mark.asyncio
async def test_notification_carries_the_transcript(client: AsyncClient, monkeypatch):
    """#264's verification step 1: the ping contains the transcript snippet.

    This also pins the background-task ORDER end-to-end — if the notification
    were scheduled before the transcriber, there would be no text to carry.
    """
    _install_model(monkeypatch, _fake_model(text="Twenty seconds about a role."))
    with patch("app.api.interactions.notify_owner") as notify:
        assert (await _post_voice(client)).status_code == 201
    notify.assert_called_once()
    event = notify.call_args.args[0]
    assert event.source == "voice_message"
    assert event.message == "Twenty seconds about a role."


@pytest.mark.asyncio
async def test_notification_still_fires_when_transcription_failed(
    client: AsyncClient, monkeypatch
):
    """The owner must hear about the message even with no transcript — with the
    reason and a pointer to the player, never silence."""
    model = MagicMock()
    model.transcribe.side_effect = RuntimeError("model file missing")
    _install_model(monkeypatch, model)
    with patch("app.api.interactions.notify_owner") as notify:
        assert (await _post_voice(client, duration_s=7.5)).status_code == 201
    notify.assert_called_once()
    event = notify.call_args.args[0]
    assert "transcription failed" in event.message
    assert "7.5s" in event.message


@pytest.mark.asyncio
async def test_notification_failure_never_breaks_intake(
    client: AsyncClient, monkeypatch
):
    _install_model(monkeypatch, _fake_model())
    with patch(
        "app.api.interactions.notify_owner",
        side_effect=RuntimeError("every channel down"),
    ):
        assert (await _post_voice(client)).status_code == 201


@pytest.mark.asyncio
async def test_notification_task_is_a_noop_for_a_deleted_interaction():
    from app.api.interactions import _notify_voice

    with patch("app.api.interactions.notify_owner") as notify:
        await _notify_voice(uuid.uuid4())
    notify.assert_not_called()


@pytest.mark.asyncio
async def test_notification_task_swallows_a_database_failure(monkeypatch):
    """The task runs outside the request; an exception escaping it would only
    surface as an unhandled-task traceback in the logs."""
    import app.api.interactions as interactions_module

    def _boom():
        raise RuntimeError("pool exhausted")

    monkeypatch.setattr(interactions_module, "async_session", _boom)
    await interactions_module._notify_voice(uuid.uuid4())  # must not raise


# --- transcription service ---------------------------------------------------


@pytest.mark.asyncio
async def test_transcription_records_an_empty_result_distinctly(
    client: AsyncClient, db_session, monkeypatch
):
    """Silence is not a failure: the model ran, there were just no words."""
    _install_model(monkeypatch, _fake_model(text=""))
    interaction_id = (await _post_voice(client)).json()["id"]
    row = await db_session.get(Interaction, uuid.UUID(interaction_id))
    await db_session.refresh(row)
    assert row.payload["transcription"] == "empty"
    assert row.message == ""


@pytest.mark.asyncio
async def test_transcription_failure_leaves_the_message_playable(
    client: AsyncClient, db_session, monkeypatch
):
    """#264's verification step 3 / acceptance criterion 2: break the
    transcriber and the message still lands, still plays, status `failed`."""
    model = MagicMock()
    model.transcribe.side_effect = OSError("no such model file")
    _install_model(monkeypatch, model)

    resp = await _post_voice(client)
    assert resp.status_code == 201
    interaction_id = resp.json()["id"]
    row = await db_session.get(Interaction, uuid.UUID(interaction_id))
    await db_session.refresh(row)
    assert row.payload["transcription"] == "failed"
    assert row.message == ""
    playback = await client.get(f"{ADMIN_URL}/{interaction_id}/voice")
    assert playback.status_code == 200
    assert playback.content == WEBM


@pytest.mark.asyncio
async def test_a_lying_client_cannot_buy_unbounded_transcription(
    client: AsyncClient, db_session, monkeypatch
):
    """The endpoint's duration check trusts the browser; this one does not.
    2 MB of WebM/Opus is ~3 minutes (measured), so without the decoded-length
    check a client declaring `duration_s=1` would spend minutes of the host's
    CPU per call."""
    model = _fake_model(duration=600.0)
    _install_model(monkeypatch, model)

    resp = await _post_voice(client, duration_s=1)
    assert resp.status_code == 201
    row = await db_session.get(Interaction, uuid.UUID(resp.json()["id"]))
    await db_session.refresh(row)
    assert row.payload["transcription"] == "rejected"
    assert row.payload["transcription_reason"] == "duration_cap"
    assert row.payload["duration_s"] == 600.0
    assert row.message == ""


@pytest.mark.asyncio
async def test_the_duration_cap_is_checked_before_the_segments_are_decoded(
    monkeypatch,
):
    """Contract 2 of the module docstring, at the seam: the expensive work is
    the per-segment generator, so an over-cap recording must leave it
    UNCONSUMED. Asserting only the payload status would pass even if the whole
    audio had been transcribed first."""
    from app.services.transcription import DurationCapExceeded, _transcribe_sync

    consumed = []

    def _segments():
        consumed.append(True)  # pragma: no cover - the point is it never runs
        yield SimpleNamespace(text="should never be decoded")

    model = MagicMock()
    model.transcribe.return_value = (
        _segments(),
        SimpleNamespace(duration=120.0, language="en"),
    )
    _install_model(monkeypatch, model)

    with pytest.raises(DurationCapExceeded) as excinfo:
        _transcribe_sync(WEBM, 90.0)
    assert excinfo.value.duration_seconds == 120.0
    assert consumed == []


def test_transcribe_sync_joins_segments_and_normalizes_the_info(monkeypatch):
    from app.services.transcription import _transcribe_sync

    model = MagicMock()
    model.transcribe.return_value = (
        iter(
            [
                SimpleNamespace(text="  We have a role  "),
                SimpleNamespace(text=" for you. "),
                SimpleNamespace(text=None),  # the API types `text` as str, be safe
            ]
        ),
        SimpleNamespace(duration=18.25, language="en-GB-long-value-truncated"),
    )
    _install_model(monkeypatch, model)

    result = _transcribe_sync(WEBM, 90.0)
    assert result.text == "We have a role for you."
    assert result.duration_seconds == 18.25
    # `Interaction.detected_language` is String(8); an over-long code from the
    # model would otherwise fail the INSERT after a successful transcription.
    assert len(result.language) <= 8
    # Greedy decoding + VAD: the small-VPS latency choices, asserted at the
    # seam rather than described in a comment.
    assert model.transcribe.call_args.kwargs["beam_size"] == 1
    assert model.transcribe.call_args.kwargs["vad_filter"] is True


def test_transcribe_sync_survives_an_info_without_duration(monkeypatch):
    """A `getattr` default only earns its place if something can hit it."""
    from app.services.transcription import _transcribe_sync

    model = MagicMock()
    model.transcribe.return_value = (iter([]), SimpleNamespace())
    _install_model(monkeypatch, model)

    result = _transcribe_sync(WEBM, 90.0)
    assert result.duration_seconds == 0.0
    assert result.language == ""


@pytest.mark.asyncio
async def test_transcription_task_is_a_noop_for_a_deleted_interaction():
    from app.services.transcription import transcribe_voice_message

    await transcribe_voice_message(uuid.uuid4())  # must not raise


@pytest.mark.asyncio
async def test_transcription_task_is_a_noop_without_a_source_ref(db_session):
    from app.services.transcription import transcribe_voice_message

    interaction = Interaction(
        source="contact_form",
        status="new",
        name="Rita",
        email="rita@agency.example",
        message="Typed.",
    )
    db_session.add(interaction)
    await db_session.commit()
    await transcribe_voice_message(interaction.id)
    await db_session.refresh(interaction)
    assert interaction.message == "Typed."


@pytest.mark.asyncio
async def test_transcription_task_handles_a_dangling_audio_pointer(db_session):
    from app.services.transcription import transcribe_voice_message

    interaction = Interaction(
        source="voice_message",
        source_ref=uuid.uuid4(),
        status="new",
        name="Voice message",
        email="",
        message="",
        payload={"transcription": "pending"},
    )
    db_session.add(interaction)
    await db_session.commit()
    await transcribe_voice_message(interaction.id)
    await db_session.refresh(interaction)
    # Nothing to transcribe and nothing to claim: the status is left as-is.
    assert interaction.payload["transcription"] == "pending"


@pytest.mark.asyncio
async def test_transcription_task_swallows_a_database_failure(monkeypatch):
    from app.services import transcription

    def _boom():
        raise RuntimeError("pool exhausted")

    monkeypatch.setattr(transcription, "async_session", _boom)
    await transcription.transcribe_voice_message(uuid.uuid4())  # must not raise


@pytest.mark.asyncio
async def test_payload_updates_are_flushed(
    client: AsyncClient, db_session, monkeypatch
):
    """SQLAlchemy tracks JSONB by identity: mutating the existing dict in place
    is NOT flushed, so the status would stay `pending` forever. Read through a
    SECOND session so the assertion cannot be satisfied by the in-memory
    object the task happened to leave behind."""
    from conftest import get_test_async_session

    _install_model(monkeypatch, _fake_model(text="Persisted."))
    interaction_id = uuid.UUID((await _post_voice(client)).json()["id"])
    async with get_test_async_session()() as fresh:
        row = await fresh.get(Interaction, interaction_id)
        assert row is not None
        assert row.payload["transcription"] == "done"
        assert row.message == "Persisted."
        # The intake keys survive the merge rather than being replaced.
        assert row.payload["voice_message_id"]
        assert row.payload["size_bytes"] == len(WEBM)


# --- the Whisper boundary itself (rule 10) -----------------------------------


def test_model_loader_is_local_and_uses_the_cached_volume(
    monkeypatch, real_whisper_loader
):
    """The ONE test that runs `_load_model`'s real body — against a FAKE
    `faster_whisper` module, so no weights are downloaded.

    Asserted at the SEAM (§49): what `WhisperModel` RECEIVES. `download_root`
    is the whole cached-volume contract — pointed anywhere but the mounted
    `WHISPER_MODEL_DIR`, the weights would be re-downloaded on every container
    start — and `device="cpu"` with no key/URL anywhere is rule 10 structurally.
    """
    import sys

    constructed = MagicMock(name="WhisperModel")
    fake_module = SimpleNamespace(WhisperModel=constructed)
    monkeypatch.setitem(sys.modules, "faster_whisper", fake_module)
    monkeypatch.setattr(settings, "whisper_model", "small-sentinel")
    monkeypatch.setattr(settings, "whisper_compute_type", "int4-sentinel")
    monkeypatch.setattr(settings, "whisper_model_dir", "/sentinel/whisper-cache")

    model = real_whisper_loader.__wrapped__()  # past the process-wide cache

    assert model is constructed.return_value
    assert constructed.call_args.args == ("small-sentinel",)
    assert constructed.call_args.kwargs == {
        "device": "cpu",
        "compute_type": "int4-sentinel",
        "download_root": "/sentinel/whisper-cache",
    }


def test_model_loader_is_cached_per_process(monkeypatch, real_whisper_loader):
    """A per-message load would re-read ~150 MB of weights every time."""
    import sys

    constructed = MagicMock(name="WhisperModel")
    monkeypatch.setitem(
        sys.modules, "faster_whisper", SimpleNamespace(WhisperModel=constructed)
    )
    first = real_whisper_loader()
    second = real_whisper_loader()
    assert first is second
    assert constructed.call_count == 1


def test_the_suite_refuses_to_load_a_real_model():
    """Mutation guard for `tests/conftest.py::_forbid_real_whisper_model`: if
    that fixture stopped replacing the loader, this call would try to DOWNLOAD
    a model instead of raising."""
    from app.services import transcription

    with pytest.raises(AssertionError, match="REAL Whisper model"):
        transcription._load_model()


# --- translation of the transcript (#248) ------------------------------------


@pytest.mark.asyncio
async def test_transcript_is_translated_like_any_message(
    client: AsyncClient, db_session, monkeypatch
):
    """#264 phase 2: "#248's translation then applies to it like any message"."""
    from unittest.mock import AsyncMock

    _install_model(
        monkeypatch, _fake_model(text="Wir haben eine Stelle.", language="de")
    )
    monkeypatch.setattr(
        "app.services.translation._generate",
        AsyncMock(return_value='{"language": "de", "translation": "We have a role."}'),
    )
    resp = await _post_voice(client)
    row = await db_session.get(Interaction, uuid.UUID(resp.json()["id"]))
    await db_session.refresh(row)
    assert row.message == "Wir haben eine Stelle."
    assert row.translated_message == "We have a role."
    assert row.translation_status == "done"


@pytest.mark.asyncio
async def test_translation_disabled_schedules_no_translation_for_a_transcript(
    client: AsyncClient, db_session, monkeypatch
):
    """`TRANSLATION_ENABLED=false` means the task is never SCHEDULED — the
    #248 contract, and the reason the endpoint branches instead of relying on
    the task's own early return."""
    from unittest.mock import AsyncMock

    monkeypatch.setattr(settings, "translation_enabled", False)
    _install_model(monkeypatch, _fake_model(text="Bonjour.", language="fr"))
    generate = AsyncMock(return_value='{"language": "fr", "translation": "Hello."}')
    monkeypatch.setattr("app.services.translation._generate", generate)

    resp = await _post_voice(client)
    assert resp.status_code == 201
    row = await db_session.get(Interaction, uuid.UUID(resp.json()["id"]))
    await db_session.refresh(row)
    # Transcription still ran — only translation is off.
    assert row.message == "Bonjour."
    assert row.translation_status is None
    generate.assert_not_called()


@pytest.mark.asyncio
async def test_a_failed_transcription_is_not_reported_as_a_failed_translation(
    client: AsyncClient, db_session, monkeypatch
):
    """With no transcript there is no text to translate, so the LLM must not be
    called at all — and the row must not claim translation failed, which would
    blame translation for a transcription problem."""
    from unittest.mock import AsyncMock

    model = MagicMock()
    model.transcribe.side_effect = RuntimeError("model file missing")
    _install_model(monkeypatch, model)
    generate = AsyncMock(return_value='{"language": "en", "translation": ""}')
    monkeypatch.setattr("app.services.translation._generate", generate)

    resp = await _post_voice(client)
    row = await db_session.get(Interaction, uuid.UUID(resp.json()["id"]))
    await db_session.refresh(row)
    assert row.translation_status is None
    generate.assert_not_called()


# --- promote-to-pipeline (#278) ----------------------------------------------


@pytest.mark.asyncio
async def test_promoting_a_voice_message_keeps_its_origin(
    client: AsyncClient, monkeypatch
):
    """#278: an interaction's ORIGIN must survive promotion. A voice message is
    a recruiter reaching out, so the card reads `recruiter_outreach` — and the
    mapping says so explicitly rather than relying on the fallback."""
    from app.api.opportunities import INTERACTION_TO_OPPORTUNITY_SOURCE

    assert INTERACTION_TO_OPPORTUNITY_SOURCE["voice_message"] == "recruiter_outreach"

    _install_model(monkeypatch, _fake_model(text="A role for you."))
    interaction_id = (await _post_voice(client, company="Agency GmbH")).json()["id"]
    resp = await client.post(
        f"{settings.api_prefix}/admin/opportunities/promote",
        json={"interaction_id": interaction_id},
    )
    assert resp.status_code == 201
    assert resp.json()["source"] == "recruiter_outreach"
    assert "A role for you." in resp.json()["notes"][0]["body"]
