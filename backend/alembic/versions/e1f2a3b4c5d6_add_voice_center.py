"""add reel voice-center mix

Revision ID: e1f2a3b4c5d6
Revises: d0e1f2a3b4c5
Create Date: 2026-11-02 13:20:00.000000
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "e1f2a3b4c5d6"
down_revision: str | None = "d0e1f2a3b4c5"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    with op.batch_alter_table("reels", schema=None) as batch_op:
        batch_op.add_column(
            sa.Column(
                "voice_center",
                sa.Float(),
                nullable=False,
                server_default="0.35",
            )
        )


def downgrade() -> None:
    with op.batch_alter_table("reels", schema=None) as batch_op:
        batch_op.drop_column("voice_center")
