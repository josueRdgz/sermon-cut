"""per-segment voice audio offset

Revision ID: d0e1f2a3b4c5
Revises: c9d0e1f2a3b4
Create Date: 2026-10-23 12:00:00.000000
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "d0e1f2a3b4c5"
down_revision: str | None = "c9d0e1f2a3b4"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    with op.batch_alter_table("reel_segments", schema=None) as batch_op:
        batch_op.add_column(
            sa.Column("audio_offset_ms", sa.Integer(), nullable=False, server_default="0")
        )
    op.execute(
        """
        UPDATE reel_segments
        SET audio_offset_ms = (
            SELECT reels.audio_offset_ms
            FROM reels
            WHERE reels.id = reel_segments.reel_id
        )
        WHERE EXISTS (
            SELECT 1
            FROM reels
            WHERE reels.id = reel_segments.reel_id
              AND reels.audio_offset_ms != 0
        )
        """
    )
    op.execute("UPDATE reels SET audio_offset_ms = 0")


def downgrade() -> None:
    with op.batch_alter_table("reel_segments", schema=None) as batch_op:
        batch_op.drop_column("audio_offset_ms")
