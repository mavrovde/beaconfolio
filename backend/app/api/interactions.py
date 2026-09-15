"""Recruiter communication hub (#69), extended by the voice channel (#264).

Public: ``POST /interactions/contact`` — the site's contact/inquiry form.
        ``POST /interactions/voice``   — a browser voice message (#264),
        flag-gated, size/duration-capped and rate-limited.
Admin:  ``GET /admin/interactions`` (filterable inbox),
        ``PATCH /admin/interactions/{id}`` (status workflow) and
        ``GET /admin/interactions/{id}/voice`` (audio playback).

Every inbound recruiter touch lands as an ``Interaction`` row; source-specific
records (e.g. ``CvRequest``, ``VoiceMessage``) keep their own tables and link
via ``source``/``source_ref``. Email notification reuses the existing SMTP flow
and — like the CV path — is a background task that never blocks intake.
"""

import asyncio
import re
import uuid
from math import ceil
from typing import Any

from fastapi import (
    APIRouter,
    BackgroundTasks,
    Depends,
    File,
    Form,
    HTTPException,
    Query,
    UploadFile,
)
from fastapi.exceptions import RequestValidationError
from fastapi.responses import Response
from pydantic import (
    BaseModel,
    EmailStr,
    Field,
    ValidationError,
    field_validator,
)
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.database import async_session, get_db
from app.logger import logger
from app.models.interaction import (
    INTERACTION_SOURCES,
    INTERACTION_STATUSES,
    Interaction,
)
from app.models.user import User
from app.models.voice_message import VoiceMessage
from app.services.auth import get_current_admin_user
from app.services.engagement import record_event
from app.services.notifications import OwnerNotification, notify_owner
from app.services.rate_limit import SlidingWindowRateLimiter, rate_limit_dependency
from app.services.transcription import transcribe_voice_message
from app.services.translation import translate_interaction

router = APIRouter(prefix="/interactions", tags=["interactions"])
admin_router = APIRouter(prefix="/admin/interactions", tags=["admin-interactions"])


# The contact form is a public, unauthenticated WRITE: every request costs a DB
# row and an outbound owner email, so it gets the same per-client-IP limiter the
# public profile GETs use, with a much tighter budget (see `app.services.rate_limit`).
def _build_contact_limiter() -> SlidingWindowRateLimiter:
    # Factory so tests can pin the settings wiring with SENTINEL values —
    # asserting equality against unmodified defaults pins nothing (§25).
    return SlidingWindowRateLimiter(
        max_requests=settings.contact_rate_limit_requests,
        window_seconds=settings.contact_rate_limit_window_seconds,
    )


contact_rate_limiter = _build_contact_limiter()
_enforce_contact_rate_limit = rate_limit_dependency(contact_rate_limiter)


# A voice message is the most expensive public write this backend has: a DB row,
# up to 2 MB of audio, and SECONDS of CPU for transcription. Its budget is
# therefore tighter than the contact form's (#264) \u2014 same limiter, own settings.
def _build_voice_limiter() -> SlidingWindowRateLimiter:
    return SlidingWindowRateLimiter(
        max_requests=settings.voice_rate_limit_requests,
        window_seconds=settings.voice_rate_limit_window_seconds,
    )


voice_rate_limiter = _build_voice_limiter()
_enforce_voice_rate_limit = rate_limit_dependency(voice_rate_limiter)


async def _require_voice_enabled() -> None:
    """Flag off = the endpoint does not exist (#264's acceptance criterion).

    Ordered BEFORE the rate limiter in the route's dependency list so a
    disabled channel answers 404 rather than spending a client's budget.
    """
    if not settings.voice_messages_enabled:
        raise HTTPException(status_code=404, detail="Voice messages are disabled")


# MediaRecorder's `mimeType` carries codec parameters ("audio/webm;codecs=opus")
# \u2014 match on the base type only. Both containers here are what browsers actually
# produce: Chromium/Firefox give webm/Opus, Firefox can give ogg/Opus.
VOICE_CONTENT_TYPES = ("audio/webm", "audio/ogg")
_VOICE_EXTENSIONS = {"audio/webm": "webm", "audio/ogg": "ogg"}

_LINE_BREAKS = re.compile(r"[\r\n\x0b\x0c\u2028\u2029]+")


class ContactRequest(BaseModel):
    # Length bounds mirror the frontend form validators (contact-form.component.ts)
    # and are checked AFTER normalization, so whitespace-only padding can't satisfy them.
    name: str = Field(min_length=2, max_length=200)
    email: EmailStr
    company: str | None = Field(default=None, max_length=200)
    message: str = Field(min_length=5, max_length=10_000)

    @field_validator("name", "company", mode="before")
    @classmethod
    def _single_line(cls, v: object) -> object:
        # Header-bound fields: a line break in `name` reaches the notification's
        # Subject and makes the stdlib refuse the whole email — fold to spaces.
        if isinstance(v, str):
            v = _LINE_BREAKS.sub(" ", v).strip()
            return v or None
        return v

    @field_validator("message", mode="before")
    @classmethod
    def _strip_message(cls, v: object) -> object:
        return v.strip() if isinstance(v, str) else v


class VoiceMessageMeta(BaseModel):
    """The non-audio half of a voice upload (#264).

    Validated as a model but NOT declared as the request body: FastAPI nests a
    form model under its parameter name when the signature also has an
    ``UploadFile`` (measured: the flat fields produced
    ``{"loc": ["body", "meta"], "type": "missing"}``), and a nested form field
    is not something ``FormData.append`` produces. The endpoint therefore
    takes flat ``Form(...)`` parameters and feeds them through here, so the
    wire format stays flat while the rules stay in one place.

    Name/email are OPTIONAL here and required on the contact form, which is the
    whole point of the channel: "one tap for the recruiter". A recruiter who
    leaves their details gets them on the inbox row; one who does not still
    lands in the inbox, and whatever they say in the recording is the reply
    path. Validation is otherwise identical to ``ContactRequest`` — same length
    bounds, same line-break folding on the header-bound fields.
    """

    # What MediaRecorder measured. ADVISORY (the server cannot know without
    # decoding) and treated as such: it rejects an honest oversize recording
    # cheaply, while the authoritative check runs against the decoded audio in
    # `app.services.transcription`.
    duration_s: float = Field(gt=0)
    name: str | None = Field(default=None, min_length=2, max_length=200)
    email: EmailStr | None = None
    company: str | None = Field(default=None, max_length=200)

    @field_validator("name", "company", "email", mode="before")
    @classmethod
    def _single_line(cls, v: object) -> object:
        # A multipart form sends an untouched field as "", which must mean
        # "absent" — an empty string would fail EmailStr and min_length
        # instead of falling back to the anonymous defaults below.
        if isinstance(v, str):
            v = _LINE_BREAKS.sub(" ", v).strip()
            return v or None
        return v


class InteractionOut(BaseModel):
    id: uuid.UUID
    source: str
    status: str
    name: str
    email: str
    company: str | None
    message: str
    payload: dict[str, Any] | None
    detected_language: str | None
    translated_message: str | None
    translated_to: str | None
    translation_status: str | None
    created_at: str
    updated_at: str

    @classmethod
    def from_model(cls, i: Interaction) -> "InteractionOut":
        return cls(
            id=i.id,
            source=i.source,
            status=i.status,
            name=i.name,
            email=i.email,
            company=i.company,
            message=i.message,
            payload=i.payload,
            detected_language=i.detected_language,
            translated_message=i.translated_message,
            translated_to=i.translated_to,
            translation_status=i.translation_status,
            created_at=i.created_at.isoformat(),
            updated_at=i.updated_at.isoformat(),
        )


class InteractionPage(BaseModel):
    items: list[InteractionOut]
    total: int
    page: int
    pages: int


class StatusPatch(BaseModel):
    status: str


def _notify(
    name: str,
    email: str,
    company: str | None,
    message: str,
    source: str = "contact_form",
) -> None:
    try:
        notify_owner(
            OwnerNotification.build(
                source=source,
                name=name,
                email=email,
                company=company,
                message=message,
            )
        )
    except Exception as e:  # never let notification failures surface anywhere
        logger.error(f"Interaction notification failed: {type(e).__name__}")


@router.post(
    "/contact",
    status_code=201,
    response_model=InteractionOut,
    dependencies=[Depends(_enforce_contact_rate_limit)],
)
async def submit_contact(
    body: ContactRequest,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
) -> InteractionOut:
    """Public contact/inquiry form — creates a source=contact_form interaction."""
    interaction = Interaction(
        source="contact_form",
        status="new",
        name=body.name,
        email=body.email,
        company=body.company,
        message=body.message,
    )
    db.add(interaction)
    await db.commit()
    await db.refresh(interaction)
    # Engagement analytics (#249): counted after the intake commit, scheduled
    # rather than awaited, and best-effort by contract — the event references
    # this row instead of copying the recruiter's identity into a second table.
    background_tasks.add_task(
        record_event, "contact_submitted", subject_id=interaction.id
    )
    background_tasks.add_task(
        _notify, body.name, body.email, body.company, body.message
    )
    # Transparent translation (#248): background, after the response — intake
    # never blocks on it, and the task records its own status on the row.
    if settings.translation_enabled:
        background_tasks.add_task(translate_interaction, interaction.id)
    return InteractionOut.from_model(interaction)


async def _notify_voice(interaction_id: uuid.UUID) -> None:
    """Owner notification for a voice message (#264).

    Scheduled AFTER the transcription task on purpose. Starlette runs a
    request's background tasks IN ORDER, so by the time this reads the row the
    transcript is already on it — the owner gets ONE ping that contains the
    text (the issue's "killer combo"), not a content-free "audio received"
    followed by a second ping later. And because the transcriber swallows its
    own failures, this task runs either way: a failed transcription still
    notifies, with the reason instead of the text.
    """
    try:
        async with async_session() as db:
            interaction = await db.get(Interaction, interaction_id)
            if interaction is None:  # deleted before we ran
                return
            payload = interaction.payload or {}
            transcript = (interaction.message or "").strip()
            duration = payload.get("duration_s") or payload.get("claimed_duration_s")
            body = transcript or (
                f"(voice message, {duration}s — transcription "
                f"{payload.get('transcription', 'unavailable')}; "
                "play it in the admin Inbox)"
            )
            name, email, company = (
                interaction.name,
                interaction.email,
                interaction.company,
            )
        # `notify_owner` is BLOCKING httpx/SMTP. A sync background task would
        # be run in Starlette's threadpool for free, but this one had to be
        # async to read the row — so hand the blocking half to a thread
        # explicitly rather than stalling the event loop for every channel.
        await asyncio.to_thread(_notify, name, email, company, body, "voice_message")
    except Exception as e:
        logger.error(
            f"Voice notification failed for {interaction_id}: {type(e).__name__}"
        )


@router.post(
    "/voice",
    status_code=201,
    response_model=InteractionOut,
    # ORDER MATTERS: a disabled channel must 404 without consuming the
    # caller's rate-limit budget.
    dependencies=[Depends(_require_voice_enabled), Depends(_enforce_voice_rate_limit)],
)
async def submit_voice_message(
    background_tasks: BackgroundTasks,
    audio: UploadFile = File(...),
    duration_s: float = Form(...),
    name: str | None = Form(default=None),
    email: str | None = Form(default=None),
    company: str | None = Form(default=None),
    db: AsyncSession = Depends(get_db),
) -> InteractionOut:
    """Public voice message (#264) — creates a source=voice_message interaction.

    Intake is deliberately dumb and fast: validate, store, commit, 201. Every
    expensive or fallible thing — transcription, notification, translation —
    is a background task, so a broken Whisper model or a dead Telegram bot can
    never cost the owner a recruiter contact (#69's intake contract).
    """
    try:
        meta = VoiceMessageMeta(
            duration_s=duration_s, name=name, email=email, company=company
        )
    except ValidationError as e:
        # Re-raised as FastAPI's own body-validation error so a bad name or
        # email answers with the SAME 422 shape the contact form produces,
        # rather than a second, endpoint-specific error format.
        raise RequestValidationError(
            [{**err, "loc": ("body", *err["loc"])} for err in e.errors()]
        ) from e
    base_type = (audio.content_type or "").split(";")[0].strip().lower()
    if base_type not in VOICE_CONTENT_TYPES:
        # 415 rather than the 400 the CV upload uses: the browser picks the
        # container from `MediaRecorder.isTypeSupported`, so it needs to tell
        # "wrong codec, try the other one" apart from "malformed request".
        raise HTTPException(
            status_code=415,
            detail=f"Audio must be one of: {', '.join(VOICE_CONTENT_TYPES)}.",
        )
    if meta.duration_s > settings.voice_message_max_duration_seconds:
        raise HTTPException(
            status_code=413,
            detail=(
                "Recording exceeds the "
                f"{settings.voice_message_max_duration_seconds}s limit."
            ),
        )
    max_bytes = settings.voice_message_max_bytes
    # Bounded read (the `admin_profile.py` upload idiom): reading max+1 bytes is
    # what makes the cap a real memory bound — `await audio.read()` would buffer
    # whatever the client sent before we could reject it.
    data = await audio.read(max_bytes + 1)
    if len(data) > max_bytes:
        raise HTTPException(
            status_code=413,
            detail=f"Audio exceeds the {max_bytes // (1024 * 1024)} MB limit.",
        )
    if not data:
        raise HTTPException(status_code=422, detail="Audio payload is empty.")

    voice = VoiceMessage(
        content_type=base_type,
        data=data,
        size_bytes=len(data),
        claimed_duration_seconds=meta.duration_s,
    )
    db.add(voice)
    await db.flush()
    interaction = Interaction(
        source="voice_message",
        source_ref=voice.id,
        status="new",
        name=meta.name or "Voice message",
        # No email is the honest representation of an anonymous note; the
        # column is NOT NULL and the inbox renders it as "no address".
        email=meta.email or "",
        company=meta.company,
        # EMPTY until the transcriber writes the text here (not into the
        # payload): the inbox list, promote-to-pipeline and #248's translation
        # all read `message`, so a voice message becomes an ordinary message
        # the moment it has words — no per-source special-casing downstream.
        message="",
        payload={
            "voice_message_id": str(voice.id),
            "content_type": base_type,
            "size_bytes": len(data),
            "claimed_duration_s": meta.duration_s,
            "transcription": "pending",
            "transcription_model": settings.whisper_model,
        },
    )
    db.add(interaction)
    await db.commit()

    # Ordered, and the order is the contract (see `_notify_voice`):
    # transcribe → notify (with the transcript) → translate (of the transcript).
    background_tasks.add_task(transcribe_voice_message, interaction.id)
    background_tasks.add_task(_notify_voice, interaction.id)
    if settings.translation_enabled:
        background_tasks.add_task(translate_interaction, interaction.id)
    return InteractionOut.from_model(interaction)


@admin_router.get("", response_model=InteractionPage)
async def list_interactions(
    status: str | None = Query(default=None),
    source: str | None = Query(default=None),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
    _admin: User = Depends(get_current_admin_user),
) -> InteractionPage:
    """Admin inbox: newest first, filterable by status and source."""
    if status is not None and status not in INTERACTION_STATUSES:
        raise HTTPException(status_code=422, detail=f"Unknown status '{status}'")
    if source is not None and source not in INTERACTION_SOURCES:
        raise HTTPException(status_code=422, detail=f"Unknown source '{source}'")

    query = select(Interaction)
    count_query = select(func.count(Interaction.id))
    if status is not None:
        query = query.where(Interaction.status == status)
        count_query = count_query.where(Interaction.status == status)
    if source is not None:
        query = query.where(Interaction.source == source)
        count_query = count_query.where(Interaction.source == source)

    total = (await db.execute(count_query)).scalar_one()
    rows = (
        (
            await db.execute(
                query.order_by(Interaction.created_at.desc())
                .offset((page - 1) * page_size)
                .limit(page_size)
            )
        )
        .scalars()
        .all()
    )
    return InteractionPage(
        items=[InteractionOut.from_model(i) for i in rows],
        total=total,
        page=page,
        pages=max(1, ceil(total / page_size)),
    )


@admin_router.patch("/{interaction_id}", response_model=InteractionOut)
async def update_status(
    interaction_id: uuid.UUID,
    body: StatusPatch,
    db: AsyncSession = Depends(get_db),
    _admin: User = Depends(get_current_admin_user),
) -> InteractionOut:
    """Move an interaction through the status workflow (new → ... → closed)."""
    if body.status not in INTERACTION_STATUSES:
        raise HTTPException(status_code=422, detail=f"Unknown status '{body.status}'")
    interaction = (
        (await db.execute(select(Interaction).where(Interaction.id == interaction_id)))
        .scalars()
        .first()
    )
    if interaction is None:
        raise HTTPException(status_code=404, detail="Interaction not found")
    interaction.status = body.status
    await db.commit()
    await db.refresh(interaction)
    return InteractionOut.from_model(interaction)


@admin_router.post("/{interaction_id}/translate", response_model=InteractionOut)
async def rerun_translation(
    interaction_id: uuid.UUID,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
    _admin: User = Depends(get_current_admin_user),
) -> InteractionOut:
    """Re-run translation on demand (#248: translated_* are separate and
    re-runnable — e.g. after fixing the model config, or for rows that predate
    the feature). Resets status to 'pending' so the UI can show progress; the
    background task overwrites only the translated_* columns, never `message`."""
    if not settings.translation_enabled:
        raise HTTPException(status_code=409, detail="Translation is disabled")
    interaction = await db.get(Interaction, interaction_id)
    if interaction is None:
        raise HTTPException(status_code=404, detail="Interaction not found")
    interaction.translation_status = "pending"
    await db.commit()
    # No refresh on purpose (#298 round 3): the docstring promises this
    # response says 'pending', but a refresh SELECT after the commit can read
    # back a CONCURRENT task's write (intake translation finishing on the same
    # event loop) — the await boundary handed it the loop. expire_on_commit=
    # False keeps the in-memory 'pending' valid without a round-trip.
    background_tasks.add_task(translate_interaction, interaction.id)
    return InteractionOut.from_model(interaction)


@admin_router.get("/{interaction_id}/voice")
async def get_voice_audio(
    interaction_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    _admin: User = Depends(get_current_admin_user),
) -> Response:
    """Stream one voice message's audio for the admin player (#264).

    ADMIN-ONLY, and NOT behind ``VOICE_MESSAGES_ENABLED``, deliberately: the
    flag governs whether visitors can SEND (no endpoint, no widget, no model
    download — #264's criterion), but turning intake off must not orphan
    recordings the owner already received. A recruiter's voice is personal
    data, so there is no public route to it at all.
    """
    interaction = await db.get(Interaction, interaction_id)
    if (
        interaction is None
        or interaction.source != "voice_message"
        or interaction.source_ref is None
    ):
        raise HTTPException(status_code=404, detail="Voice message not found")
    voice = await db.get(VoiceMessage, interaction.source_ref)
    if voice is None:
        raise HTTPException(status_code=404, detail="Voice message not found")
    extension = _VOICE_EXTENSIONS.get(voice.content_type, "bin")
    return Response(
        content=voice.data,
        media_type=voice.content_type,
        headers={
            # `inline` so <audio> plays it instead of the browser downloading
            # it; `private` so no shared cache ever holds recruiter audio.
            "Content-Disposition": (
                f'inline; filename="voice-{interaction_id}.{extension}"'
            ),
            "Cache-Control": "private, max-age=3600",
        },
    )
