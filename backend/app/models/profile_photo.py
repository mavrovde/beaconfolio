import uuid
from datetime import UTC, datetime

from sqlalchemy import DateTime, LargeBinary, String
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class ProfilePhoto(Base):
    """The owner's portrait, stored in the DB so it survives every rollout.

    Single-active semantics: an upload REPLACES the previous row rather than
    versioning it (unlike ``CvDocument``/``ProfileSnapshot``) — the hero has
    exactly one portrait slot and old bytes of a face have no replay value,
    only PII surface (#66).
    """

    __tablename__ = "profile_photos"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    content_type: Mapped[str] = mapped_column(String(64), nullable=False)
    data: Mapped[bytes] = mapped_column(LargeBinary, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(UTC)
    )
