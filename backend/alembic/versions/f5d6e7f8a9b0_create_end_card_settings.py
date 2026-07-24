"""create end_card_settings table

Revision ID: f5d6e7f8a9b0
Revises: e4c5d6e7f8a9
Create Date: 2026-07-24 14:50:00.000000

"""
from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "f5d6e7f8a9b0"
down_revision: str | None = "e4c5d6e7f8a9"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "end_card_settings",
        sa.Column("id", sa.Uuid(), nullable=False),
        # NULL project_id == global defaults.
        sa.Column("project_id", sa.Uuid(), nullable=True),
        sa.Column(
            "layout",
            sa.Enum(
                "cover_full", "cover_card", "minimal",
                name="end_card_layout", native_enum=False, length=32,
            ),
            nullable=False,
        ),
        sa.Column("duration_seconds", sa.Float(), nullable=False),
        sa.Column("fade_in_ms", sa.Integer(), nullable=False),
        sa.Column("audio_fade_out_ms", sa.Integer(), nullable=False),
        sa.Column(
            "audio_mode",
            sa.Enum(
                "silence", "continue_with_fade", "local_music",
                name="end_card_audio_mode", native_enum=False, length=32,
            ),
            nullable=False,
        ),
        sa.Column("music_filename", sa.String(length=255), nullable=True),
        sa.Column("music_volume", sa.Float(), nullable=False),
        sa.Column("logo_filename", sa.String(length=255), nullable=True),
        sa.Column("url_text", sa.String(length=500), nullable=True),
        sa.Column("show_qr", sa.Boolean(), nullable=False),
        sa.Column("qr_url", sa.String(length=500), nullable=True),
        sa.Column("channel_handle", sa.String(length=200), nullable=True),
        sa.Column("custom_message", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["project_id"], ["projects.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    with op.batch_alter_table("end_card_settings", schema=None) as batch_op:
        batch_op.create_index(
            batch_op.f("ix_end_card_settings_project_id"),
            ["project_id"],
            unique=True,
        )


def downgrade() -> None:
    with op.batch_alter_table("end_card_settings", schema=None) as batch_op:
        batch_op.drop_index(batch_op.f("ix_end_card_settings_project_id"))

    op.drop_table("end_card_settings")
