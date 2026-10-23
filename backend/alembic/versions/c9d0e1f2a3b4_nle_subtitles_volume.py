"""subtitle placement/font and volume keyframes

Revision ID: c9d0e1f2a3b4
Revises: b8c9d0e1f2a3
Create Date: 2026-10-22 17:00:00.000000
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "c9d0e1f2a3b4"
down_revision: str | None = "b8c9d0e1f2a3"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    with op.batch_alter_table("reels", schema=None) as batch_op:
        batch_op.add_column(
            sa.Column("subtitle_font_family", sa.String(length=80), nullable=True)
        )
        batch_op.add_column(sa.Column("subtitle_x", sa.Float(), nullable=True))
        batch_op.add_column(sa.Column("subtitle_y", sa.Float(), nullable=True))
    with op.batch_alter_table("reel_segments", schema=None) as batch_op:
        batch_op.add_column(sa.Column("volume_keyframes_json", sa.Text(), nullable=True))
    with op.batch_alter_table("background_music_settings", schema=None) as batch_op:
        batch_op.add_column(sa.Column("volume_keyframes_json", sa.Text(), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("background_music_settings", schema=None) as batch_op:
        batch_op.drop_column("volume_keyframes_json")
    with op.batch_alter_table("reel_segments", schema=None) as batch_op:
        batch_op.drop_column("volume_keyframes_json")
    with op.batch_alter_table("reels", schema=None) as batch_op:
        batch_op.drop_column("subtitle_y")
        batch_op.drop_column("subtitle_x")
        batch_op.drop_column("subtitle_font_family")
