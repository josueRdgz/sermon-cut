"""Alembic: export profiles + render job metadata (hash, report, quality)."""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "f1a2b3c4d5e6"
down_revision: str | None = "e0f1a2b3c4d5"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "export_profiles",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("slug", sa.String(length=64), nullable=False),
        sa.Column("name", sa.String(length=120), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column(
            "platform",
            sa.Enum(
                "youtube_shorts",
                "facebook_reels",
                "instagram_reels",
                "whatsapp_status",
                "custom",
                name="export_platform",
                native_enum=False,
                length=32,
            ),
            nullable=False,
        ),
        sa.Column("width", sa.Integer(), nullable=False),
        sa.Column("height", sa.Integer(), nullable=False),
        sa.Column("aspect_ratio", sa.String(length=16), nullable=False),
        sa.Column("video_codec", sa.String(length=32), nullable=False),
        sa.Column("audio_codec", sa.String(length=32), nullable=False),
        sa.Column("max_duration_seconds", sa.Integer(), nullable=False),
        sa.Column(
            "fps_mode",
            sa.Enum(
                "original",
                "fixed_30",
                name="export_fps_mode",
                native_enum=False,
                length=16,
            ),
            nullable=False,
        ),
        sa.Column("safe_margin_x", sa.Float(), nullable=False),
        sa.Column("safe_top", sa.Float(), nullable=False),
        sa.Column("safe_bottom", sa.Float(), nullable=False),
        sa.Column("crf_draft", sa.Integer(), nullable=False),
        sa.Column("crf_standard", sa.Integer(), nullable=False),
        sa.Column("crf_high", sa.Integer(), nullable=False),
        sa.Column("preset_draft", sa.String(length=32), nullable=False),
        sa.Column("preset_standard", sa.String(length=32), nullable=False),
        sa.Column("preset_high", sa.String(length=32), nullable=False),
        sa.Column("audio_bitrate_draft_k", sa.Integer(), nullable=False),
        sa.Column("audio_bitrate_standard_k", sa.Integer(), nullable=False),
        sa.Column("audio_bitrate_high_k", sa.Integer(), nullable=False),
        sa.Column("fragmentation_enabled", sa.Boolean(), nullable=False),
        sa.Column("fragment_max_seconds", sa.Integer(), nullable=True),
        sa.Column("prefer_small_file", sa.Boolean(), nullable=False),
        sa.Column("is_builtin", sa.Boolean(), nullable=False),
        sa.Column("is_active", sa.Boolean(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("slug", name="uq_export_profiles_slug"),
    )

    with op.batch_alter_table("render_jobs", schema=None) as batch_op:
        batch_op.add_column(sa.Column("profile_id", sa.Uuid(), nullable=True))
        batch_op.add_column(sa.Column("profile_slug", sa.String(length=64), nullable=True))
        batch_op.add_column(sa.Column("profile_name", sa.String(length=120), nullable=True))
        batch_op.add_column(sa.Column("quality", sa.String(length=16), nullable=True))
        batch_op.add_column(sa.Column("crf", sa.Integer(), nullable=True))
        batch_op.add_column(sa.Column("encode_preset", sa.String(length=32), nullable=True))
        batch_op.add_column(sa.Column("audio_bitrate_k", sa.Integer(), nullable=True))
        batch_op.add_column(sa.Column("sha256", sa.String(length=64), nullable=True))
        batch_op.add_column(sa.Column("report_filename", sa.String(length=255), nullable=True))
        batch_op.add_column(sa.Column("verified", sa.Boolean(), nullable=True))
        batch_op.add_column(sa.Column("expected_audio", sa.Boolean(), nullable=True))
        batch_op.add_column(
            sa.Column("publish_status", sa.String(length=32), nullable=True)
        )
        batch_op.create_foreign_key(
            "fk_render_jobs_profile_id",
            "export_profiles",
            ["profile_id"],
            ["id"],
            ondelete="SET NULL",
        )


def downgrade() -> None:
    with op.batch_alter_table("render_jobs", schema=None) as batch_op:
        batch_op.drop_constraint("fk_render_jobs_profile_id", type_="foreignkey")
        for col in (
            "profile_id",
            "profile_slug",
            "profile_name",
            "quality",
            "crf",
            "encode_preset",
            "audio_bitrate_k",
            "sha256",
            "report_filename",
            "verified",
            "expected_audio",
            "publish_status",
        ):
            batch_op.drop_column(col)
    op.drop_table("export_profiles")
