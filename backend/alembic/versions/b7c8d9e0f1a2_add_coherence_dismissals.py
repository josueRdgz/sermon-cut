"""add coherence_dismissals_json to reels

Revision ID: b7c8d9e0f1a2
Revises: a6b7c8d9e0f1
Create Date: 2026-07-24 16:00:00.000000

"""
from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "b7c8d9e0f1a2"
down_revision: str | None = "a6b7c8d9e0f1"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    with op.batch_alter_table("reels", schema=None) as batch_op:
        batch_op.add_column(sa.Column("coherence_dismissals_json", sa.Text(), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("reels", schema=None) as batch_op:
        batch_op.drop_column("coherence_dismissals_json")
