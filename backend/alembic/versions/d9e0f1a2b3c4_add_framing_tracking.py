"""add framing_mode and manual crop columns

Revision ID: d9e0f1a2b3c4
Revises: c8d9e0f1a2b3
Create Date: 2026-07-24 17:30:00.000000

"""
from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "d9e0f1a2b3c4"
down_revision: str | None = "c8d9e0f1a2b3"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    with op.batch_alter_table("reels", schema=None) as batch_op:
        batch_op.add_column(
            sa.Column(
                "framing_mode",
                sa.String(length=32),
                nullable=False,
                server_default="center_crop",
            )
        )
    with op.batch_alter_table("reel_segments", schema=None) as batch_op:
        batch_op.add_column(sa.Column("manual_crop_x", sa.Float(), nullable=True))
        batch_op.add_column(sa.Column("manual_crop_y", sa.Float(), nullable=True))
        batch_op.add_column(sa.Column("manual_crop_zoom", sa.Float(), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("reel_segments", schema=None) as batch_op:
        batch_op.drop_column("manual_crop_zoom")
        batch_op.drop_column("manual_crop_y")
        batch_op.drop_column("manual_crop_x")
    with op.batch_alter_table("reels", schema=None) as batch_op:
        batch_op.drop_column("framing_mode")
