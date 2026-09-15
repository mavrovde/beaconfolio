"""Voice channel audio storage (#264).

Chained onto `photo0011`, the single head at authoring time — two revisions
sharing one `down_revision` give Alembic two heads and `upgrade head` (run by
`docker-entrypoint.sh` on every container start) then refuses to run, which
stops the backend booting. If a parallel migration merges first, re-chain this
one behind it; the revision id itself never changes.

Revision ID: voice0012
Revises: photo0011
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "voice0012"
down_revision: str | None = "photo0011"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # Self-adopt guard (lessons §23): a pre-Alembic DB is materialized by
    # ``Base.metadata.create_all``, which already builds this table before
    # baseline0001 is stamped.
    if sa.inspect(op.get_bind()).has_table("voice_messages"):
        return
    op.create_table(
        "voice_messages",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("content_type", sa.String(length=64), nullable=False),
        sa.Column("data", sa.LargeBinary(), nullable=False),
        sa.Column("size_bytes", sa.Integer(), nullable=False),
        sa.Column("claimed_duration_seconds", sa.Float(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    # No FK to `interactions` on purpose: the pointer runs the other way
    # (`interactions.source_ref` → here), exactly like `cv_requests`, so the
    # audio row exists before the hub row it will be referenced by.


def downgrade() -> None:
    op.drop_table("voice_messages")
