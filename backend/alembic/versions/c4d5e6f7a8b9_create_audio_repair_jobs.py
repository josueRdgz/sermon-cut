"""create_audio_repair_jobs

Revision ID: c4d5e6f7a8b9
Revises: b3c4d5e6f7a8
Create Date: 2026-08-05 12:00:00.000000
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "c4d5e6f7a8b9"
down_revision: str | None = "b3c4d5e6f7a8"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "audio_repair_jobs",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("project_id", sa.Uuid(), nullable=False),
        sa.Column(
            "status",
            sa.Enum(
                "queued",
                "running",
                "cancelling",
                "cancelled",
                "completed",
                "failed",
                name="audio_repair_job_status",
                native_enum=False,
                length=32,
            ),
            nullable=False,
        ),
        sa.Column("stage", sa.String(length=64), nullable=True),
        sa.Column("progress", sa.Float(), nullable=False),
        sa.Column("silence_threshold", sa.Integer(), nullable=False),
        sa.Column("min_dropout_ms", sa.Float(), nullable=False),
        sa.Column("max_auto_repair_ms", sa.Float(), nullable=False),
        sa.Column("max_review_ms", sa.Float(), nullable=False),
        sa.Column("issue_count", sa.Integer(), nullable=False),
        sa.Column("repaired_count", sa.Integer(), nullable=False),
        sa.Column("review_count", sa.Integer(), nullable=False),
        sa.Column("issues_json", sa.Text(), nullable=False),
        sa.Column("repaired_audio_filename", sa.String(length=255), nullable=True),
        sa.Column("repaired_video_filename", sa.String(length=255), nullable=True),
        sa.Column("error_message", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("finished_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["project_id"], ["projects.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    with op.batch_alter_table("audio_repair_jobs") as batch_op:
        batch_op.create_index(
            batch_op.f("ix_audio_repair_jobs_project_id"),
            ["project_id"],
            unique=False,
        )
        batch_op.create_index(
            batch_op.f("ix_audio_repair_jobs_status"),
            ["status"],
            unique=False,
        )


def downgrade() -> None:
    with op.batch_alter_table("audio_repair_jobs") as batch_op:
        batch_op.drop_index(batch_op.f("ix_audio_repair_jobs_status"))
        batch_op.drop_index(batch_op.f("ix_audio_repair_jobs_project_id"))
    op.drop_table("audio_repair_jobs")
