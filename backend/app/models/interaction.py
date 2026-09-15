"""Unified recruiter-interaction record (#69).

Every inbound recruiter touch — contact-form submissions, CV requests, voice
messages (#264), (later) bookings and platform-pulled messages — lands here as
ONE indexable row, so the admin inbox is the single source of truth for "who
reached out, through what, and where does it stand". Source-specific detail
stays in the source's own domain record (e.g. ``CvRequest``, ``VoiceMessage``);
``payload`` carries the lightweight extras, and ``source``/``source_ref`` link
back.
"""

import uuid
from datetime import UTC, datetime

from sqlalchemy import DateTime, Index, String, Text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base

# Extensible by design (#69): platform channels (linkedin/xing/email) join
# later without a schema change — the column is a plain string validated at
# the API layer, NOT a DB enum, exactly so new sources are additive.
INTERACTION_SOURCES = ("contact_form", "cv_request", "booking", "voice_message")
INTERACTION_STATUSES = ("new", "contacted", "in_progress", "closed")


class Interaction(Base):
    __tablename__ = "interactions"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)

    source: Mapped[str] = mapped_column(String(50), nullable=False)
    # Optional pointer to the source's domain record (e.g. cv_requests.id).
    source_ref: Mapped[uuid.UUID | None] = mapped_column(nullable=True)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="new")

    name: Mapped[str] = mapped_column(String(200), nullable=False)
    email: Mapped[str] = mapped_column(String(320), nullable=False)
    company: Mapped[str | None] = mapped_column(String(200), nullable=True)
    message: Mapped[str] = mapped_column(Text, nullable=False)

    # Source-specific extras (subject line, booking slot, platform ids, ...).
    payload: Mapped[dict | None] = mapped_column(JSONB, nullable=True)

    # Transparent translation (#248): the ORIGINAL `message` above is never
    # mutated; these are separate, re-runnable, and nullable — a row without
    # them predates the feature or has it disabled.
    detected_language: Mapped[str | None] = mapped_column(String(8), nullable=True)
    translated_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    translated_to: Mapped[str | None] = mapped_column(String(8), nullable=True)
    translation_status: Mapped[str | None] = mapped_column(String(16), nullable=True)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(UTC), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(UTC),
        onupdate=lambda: datetime.now(UTC),
        nullable=False,
    )

    __table_args__ = (
        # The inbox lists newest-first and filters by status/source.
        Index("ix_interactions_created_at", "created_at"),
        Index("ix_interactions_status", "status"),
        Index("ix_interactions_source", "source"),
    )
