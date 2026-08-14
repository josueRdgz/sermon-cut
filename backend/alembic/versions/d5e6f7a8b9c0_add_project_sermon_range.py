"""add_project_sermon_range

Revision ID: d5e6f7a8b9c0
Revises: c4d5e6f7a8b9
Create Date: 2026-08-14 09:00:00.000000
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "d5e6f7a8b9c0"
down_revision: str | None = "c4d5e6f7a8b9"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    with op.batch_alter_table("projects") as batch:
        batch.add_column(
            sa.Column(
                "source_kind",
                sa.String(length=24),
                nullable=False,
                server_default="sermon_only",
            )
        )
        batch.add_column(sa.Column("sermon_start_seconds", sa.Float(), nullable=True))
        batch.add_column(sa.Column("sermon_end_seconds", sa.Float(), nullable=True))
        batch.add_column(
            sa.Column(
                "sermon_range_confirmed",
                sa.Boolean(),
                nullable=False,
                server_default=sa.false(),
            )
        )


def downgrade() -> None:
    with op.batch_alter_table("projects") as batch:
        batch.drop_column("sermon_range_confirmed")
        batch.drop_column("sermon_end_seconds")
        batch.drop_column("sermon_start_seconds")
        batch.drop_column("source_kind")
