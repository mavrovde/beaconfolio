"""Local speech-to-text for recruiter voice messages (#264).

RULE 10, structurally: the only transcriber here is **faster-whisper**
(CTranslate2) running in this process on the CPU. There is no API key, no
endpoint, no metered call — the one network access in the whole module is
Hugging Face's anonymous model download, which happens **once** into
``WHISPER_MODEL_DIR`` and is then served from that mounted volume forever
(the same cached-volume pattern the ``ollama_data`` volume gives Ollama
models: no re-download on container start). Flag off (``VOICE_MESSAGES_ENABLED
=false``) means nothing here ever runs, so nothing is ever downloaded.

Three contracts, each pinned by a test:

1. **Transcription NEVER blocks intake.** It runs as a background task after
   the 201, opens its own session, and swallows every exception — the audio
   row and the ``Interaction`` are already committed. A failure leaves
   ``payload["transcription"] == "failed"`` and the message playable, which is
   #69's intake contract restated for audio.
2. **The duration cap is enforced against the DECODED audio, not the
   browser's claim.** The endpoint checks what the client declared (cheap,
   rejects honest oversize early) but a lying client would otherwise buy
   unbounded CPU with a 2 MB Opus file — measured, 15 s of speech is ~172 KB
   of WebM/Opus, so 2 MB is ~3 minutes, i.e. twice the cap.
   ``model.transcribe()`` decodes the container eagerly and reports
   ``info.duration`` from the sample count (verified against
   faster-whisper 1.2.1: ``decode_audio`` then ``duration = audio.shape[0] /
   sampling_rate``), while the per-segment decoder passes — the part that
   scales with length — happen only as the returned generator is consumed.
   Checking ``info.duration`` before consuming it therefore costs one decode
   plus the fixed-size language-detection pass, not a full transcription.
3. **The model is loaded once per process, lazily.** The import lives inside
   the loader so neither the app's startup nor the test suite pulls
   CTranslate2/PyAV in, and ``lru_cache`` keeps a single instance for the
   life of the worker (a per-message load would re-read ~150 MB of weights).
"""

import asyncio
import io
import uuid
from dataclasses import dataclass
from functools import lru_cache
from typing import Any

from app.config import settings
from app.database import async_session
from app.logger import logger
from app.models.interaction import Interaction
from app.models.voice_message import VoiceMessage


@dataclass(frozen=True)
class Transcript:
    """One transcription result: the text, the detected language, and the
    duration the DECODER measured (not the one the browser claimed)."""

    text: str
    language: str
    duration_seconds: float


class DurationCapExceeded(Exception):
    """The decoded audio is longer than ``VOICE_MESSAGE_MAX_DURATION_SECONDS``.

    Raised before any transcription work happens, so a client that lies about
    its recording length cannot spend the host's CPU (see contract 2 above).
    """

    def __init__(self, duration_seconds: float) -> None:
        super().__init__(f"audio is {duration_seconds:.1f}s long")
        self.duration_seconds = duration_seconds


@lru_cache(maxsize=1)
def _load_model() -> Any:
    """The process-wide faster-whisper model, built on first use.

    ``download_root`` is the whole point of ``WHISPER_MODEL_DIR``: it is a
    mounted volume, so the weights survive container recreation and the
    download happens once per host rather than once per start.
    """
    from faster_whisper import WhisperModel

    logger.info(f"Loading Whisper model '{settings.whisper_model}' (cpu)")
    return WhisperModel(
        settings.whisper_model,
        device="cpu",
        compute_type=settings.whisper_compute_type,
        download_root=settings.whisper_model_dir,
    )


def _transcribe_sync(audio: bytes, max_duration_seconds: float) -> Transcript:
    """Blocking transcription of one in-memory recording.

    Runs in a worker thread (see ``transcribe_voice_message``): CTranslate2 is
    native, CPU-bound and releases the GIL, so a thread keeps the event loop
    free for requests instead of stalling every other coroutine.
    """
    model = _load_model()
    # beam_size=1 (greedy): on the small-VPS host class this feature targets,
    # beam search multiplies decode time for a marginal accuracy gain on a
    # 20-second voice note. vad_filter drops the silence a recruiter leaves
    # before speaking, which is pure decode cost.
    segments, info = model.transcribe(io.BytesIO(audio), beam_size=1, vad_filter=True)
    duration = float(getattr(info, "duration", 0.0) or 0.0)
    if duration > max_duration_seconds:
        # `segments` is a generator over the decoder passes; we never consume
        # it, so the cost so far is one container decode, not a transcription.
        raise DurationCapExceeded(duration)
    text = " ".join((segment.text or "").strip() for segment in segments).strip()
    return Transcript(
        text=text,
        language=str(getattr(info, "language", "") or "")[:8],
        duration_seconds=duration,
    )


def _patch_payload(interaction: Interaction, **updates: Any) -> None:
    """Merge ``updates`` into the interaction's JSON payload.

    A NEW dict is assigned, never mutated in place: SQLAlchemy tracks JSONB by
    identity, so an in-place update of the existing dict is not flushed and the
    status silently stays ``pending``.
    """
    payload = dict(interaction.payload or {})
    payload.update(updates)
    interaction.payload = payload


async def transcribe_voice_message(interaction_id: uuid.UUID) -> None:
    """Background target: transcribe one voice interaction's audio in place.

    Writes the transcript into ``Interaction.message`` — not only into the
    payload — so the inbox list, the promote-to-pipeline note and #248's
    translation all treat a voice message as exactly what it is: a recruiter
    message that happens to have arrived as audio.
    """
    try:
        async with async_session() as db:
            interaction = await db.get(Interaction, interaction_id)
            if interaction is None or interaction.source_ref is None:
                # Deleted before we ran, or not a voice interaction at all.
                return
            voice = await db.get(VoiceMessage, interaction.source_ref)
            if voice is None:
                # `source_ref` is an FK-less pointer by #69's design, so a
                # dangling one is possible (a purge, a restored dump).
                logger.error(f"Voice audio missing for interaction {interaction_id}")
                return
            try:
                transcript = await asyncio.to_thread(
                    _transcribe_sync,
                    voice.data,
                    float(settings.voice_message_max_duration_seconds),
                )
            except DurationCapExceeded as e:
                # The browser under-reported the length. The audio stays
                # playable and the row records WHY there is no transcript.
                logger.warning(
                    f"Voice message {interaction_id} exceeds the duration cap "
                    f"({e.duration_seconds:.1f}s) — not transcribed"
                )
                _patch_payload(
                    interaction,
                    transcription="rejected",
                    transcription_reason="duration_cap",
                    duration_s=round(e.duration_seconds, 1),
                )
            except Exception as e:
                # A missing model, a corrupt container, an OOM: the message is
                # still a message (contract 1).
                logger.error(
                    f"Transcription failed for {interaction_id}: {type(e).__name__}"
                )
                _patch_payload(interaction, transcription="failed")
            else:
                interaction.message = transcript.text
                interaction.detected_language = transcript.language or None
                _patch_payload(
                    interaction,
                    transcription="done" if transcript.text else "empty",
                    transcription_model=settings.whisper_model,
                    duration_s=round(transcript.duration_seconds, 1),
                    language=transcript.language,
                )
            await db.commit()
    except Exception as e:
        # The session/commit itself failing must also stay inside the task —
        # same literal guarantee `translate_interaction` gives (#248).
        logger.error(
            f"Transcription task aborted for {interaction_id}: {type(e).__name__}"
        )
