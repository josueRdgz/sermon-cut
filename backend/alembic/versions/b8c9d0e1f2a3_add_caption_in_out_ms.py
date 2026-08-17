"""add independent caption in/out on reel segments

Revision ID: b8c9d0e1f2a3
Revises: a7b8c9d0e1f2
Create Date: 2026-08-15 13:55:00.000000

"""
from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "b8c9d0e1f2a3"
down_revision: str | None = "a7b8c9d0e1f2"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    with op.batch_alter_table("reel_segments", schema=None) as batch_op:
        batch_op.add_column(sa.Column("caption_in_ms", sa.Integer(), nullable=True))
        batch_op.add_column(sa.Column("caption_out_ms", sa.Integer(), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("reel_segments", schema=None) as batch_op:
        batch_op.drop_column("caption_out_ms")
        batch_op.drop_column("caption_in_ms")
