"""Runtime profile photo (#333).

Chained onto `engage0010`, the single head at authoring time — two revisions
sharing one `down_revision` give Alembic two heads and `upgrade head` (run by
`docker-entrypoint.sh` on every container start) then refuses to run. If a
parallel migration merges first, re-chain this one behind it; the revision id
itself never changes.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "photo0011"
down_revision: str | None = "engage0010"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # Self-adopt guard (lessons §23): a pre-Alembic DB is materialized by
    # ``Base.metadata.create_all``, which already builds this table before
    # baseline0001 is stamped.
    if sa.inspect(op.get_bind()).has_table("profile_photos"):
        return
    op.create_table(
        "profile_photos",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("content_type", sa.String(length=64), nullable=False),
        sa.Column("data", sa.LargeBinary(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )


def downgrade() -> None:
    op.drop_table("profile_photos")
