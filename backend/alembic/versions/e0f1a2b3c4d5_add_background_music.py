"""add background_music_settings table

Revision ID: e0f1a2b3c4d5
Revises: d9e0f1a2b3c4
Create Date: 2026-07-24 18:00:00.000000

"""
from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "e0f1a2b3c4d5"
down_revision: str | None = "d9e0f1a2b3c4"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "background_music_settings",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("project_id", sa.Uuid(), nullable=False),
        sa.Column(
            "preset",
            sa.Enum(
                "none",
                "end_card_only",
                "very_soft_background",
                name="background_music_preset",
                native_enum=False,
                length=32,
            ),
            nullable=False,
        ),
        sa.Column(
            "scope",
            sa.Enum(
                "full_reel",
                "end_card_only",
                name="background_music_scope",
                native_enum=False,
                length=32,
            ),
            nullable=False,
        ),
        sa.Column("music_filename", sa.String(length=255), nullable=True),
        sa.Column("volume", sa.Float(), nullable=False),
        sa.Column("start_seconds", sa.Float(), nullable=False),
        sa.Column("end_seconds", sa.Float(), nullable=True),
        sa.Column("fade_in_ms", sa.Integer(), nullable=False),
        sa.Column("fade_out_ms", sa.Integer(), nullable=False),
        sa.Column("ducking_enabled", sa.Boolean(), nullable=False),
        sa.Column("target_lufs", sa.Float(), nullable=False),
        sa.Column("true_peak_db", sa.Float(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["project_id"], ["projects.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("project_id", name="uq_background_music_settings_project_id"),
    )
    with op.batch_alter_table("background_music_settings", schema=None) as batch_op:
        batch_op.create_index(
            batch_op.f("ix_background_music_settings_project_id"),
            ["project_id"],
            unique=False,
        )


def downgrade() -> None:
    with op.batch_alter_table("background_music_settings", schema=None) as batch_op:
        batch_op.drop_index(batch_op.f("ix_background_music_settings_project_id"))
    op.drop_table("background_music_settings")
