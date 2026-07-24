"""create_youtube_import_jobs_table

Revision ID: a1b2c3d4e5f6
Revises: f1a2b3c4d5e6
Create Date: 2026-07-24 17:10:00.000000

"""
from __future__ import annotations

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "a1b2c3d4e5f6"
down_revision: str | None = "f1a2b3c4d5e6"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "youtube_import_jobs",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("project_id", sa.Uuid(), nullable=False),
        sa.Column(
            "status",
            sa.Enum(
                "queued",
                "validating",
                "fetching_metadata",
                "downloading_video",
                "downloading_audio",
                "merging",
                "probing",
                "completed",
                "cancelling",
                "cancelled",
                "failed",
                name="youtube_import_job_status",
                native_enum=False,
                length=32,
            ),
            nullable=False,
        ),
        sa.Column("stage", sa.String(length=64), nullable=True),
        sa.Column("source_url", sa.String(length=500), nullable=False),
        sa.Column("video_id", sa.String(length=32), nullable=False),
        sa.Column("requested_quality", sa.String(length=16), nullable=False),
        sa.Column("title", sa.String(length=500), nullable=True),
        sa.Column("channel", sa.String(length=300), nullable=True),
        sa.Column("duration_seconds", sa.Float(), nullable=True),
        sa.Column("thumbnail_url", sa.String(length=1000), nullable=True),
        sa.Column("resolution_label", sa.String(length=32), nullable=True),
        sa.Column("upload_date", sa.String(length=16), nullable=True),
        sa.Column("selected_format", sa.String(length=200), nullable=True),
        sa.Column("progress", sa.Float(), nullable=False),
        sa.Column("downloaded_bytes", sa.BigInteger(), nullable=True),
        sa.Column("total_bytes", sa.BigInteger(), nullable=True),
        sa.Column("speed_bps", sa.Float(), nullable=True),
        sa.Column("eta_seconds", sa.Float(), nullable=True),
        sa.Column("output_filename", sa.String(length=255), nullable=True),
        sa.Column("error_code", sa.String(length=64), nullable=True),
        sa.Column("error_message", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("finished_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["project_id"], ["projects.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    with op.batch_alter_table("youtube_import_jobs", schema=None) as batch_op:
        batch_op.create_index(
            batch_op.f("ix_youtube_import_jobs_project_id"), ["project_id"], unique=False
        )
        batch_op.create_index(
            batch_op.f("ix_youtube_import_jobs_status"), ["status"], unique=False
        )


def downgrade() -> None:
    with op.batch_alter_table("youtube_import_jobs", schema=None) as batch_op:
        batch_op.drop_index(batch_op.f("ix_youtube_import_jobs_status"))
        batch_op.drop_index(batch_op.f("ix_youtube_import_jobs_project_id"))

    op.drop_table("youtube_import_jobs")
