"""Stored audio for a recruiter voice message (#264).

The bytes live in the DATABASE, deliberately — the same choice
``CvDocument``/``ProfilePhoto`` already make in this repo, and for the same
reason: a rollout recreates the backend container, so anything on a
container-local path is gone, while a named volume is one more piece of state
to back up separately from the rows that reference it. A 2 MB hard cap
(``VOICE_MESSAGE_MAX_BYTES``) is what makes this affordable — the endpoint
never accepts an object large enough to make a BLOB the wrong answer.

The ``Interaction`` row (#69) is the hub entry and points here via
``source_ref``, exactly as a ``cv_request`` interaction points at its
``CvRequest``. Nothing about the inbox schema changed for this channel: that
was #69's design bet and this is the second time it has paid off.
"""

import uuid
from datetime import UTC, datetime

from sqlalchemy import DateTime, Float, Integer, LargeBinary, String
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class VoiceMessage(Base):
    __tablename__ = "voice_messages"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    content_type: Mapped[str] = mapped_column(String(64), nullable=False)
    data: Mapped[bytes] = mapped_column(LargeBinary, nullable=False)
    size_bytes: Mapped[int] = mapped_column(Integer, nullable=False)
    # What the BROWSER reported at upload time (MediaRecorder knows it; the
    # server cannot without decoding). Advisory only: the authoritative value
    # is written back by the transcriber, which decodes the container — see
    # `app.services.transcription`. Never trust it for a cap on its own.
    claimed_duration_seconds: Mapped[float] = mapped_column(Float, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(UTC), nullable=False
    )
