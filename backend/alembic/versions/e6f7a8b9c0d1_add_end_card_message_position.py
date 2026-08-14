"""add end card message position

Revision ID: e6f7a8b9c0d1
Revises: d5e6f7a8b9c0
Create Date: 2026-08-14 11:40:00.000000

"""
from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op


revision: str = "e6f7a8b9c0d1"
down_revision: str | None = "d5e6f7a8b9c0"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    with op.batch_alter_table("end_card_settings", schema=None) as batch_op:
        batch_op.add_column(
            sa.Column(
                "message_position",
                sa.String(length=16),
                nullable=False,
                server_default="bottom",
            )
        )


def downgrade() -> None:
    with op.batch_alter_table("end_card_settings", schema=None) as batch_op:
        batch_op.drop_column("message_position")
