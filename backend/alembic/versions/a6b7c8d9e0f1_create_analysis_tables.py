"""create analysis_jobs and analysis_candidates tables

Revision ID: a6b7c8d9e0f1
Revises: f5d6e7f8a9b0
Create Date: 2026-07-24 15:20:00.000000

"""
from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "a6b7c8d9e0f1"
down_revision: str | None = "f5d6e7f8a9b0"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "analysis_jobs",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("project_id", sa.Uuid(), nullable=False),
        sa.Column(
            "status",
            sa.Enum(
                "queued", "running", "cancelling", "cancelled", "completed", "failed",
                name="analysis_job_status", native_enum=False, length=32,
            ),
            nullable=False,
        ),
        sa.Column("stage", sa.String(length=64), nullable=True),
        sa.Column("provider", sa.String(length=32), nullable=False),
        sa.Column("max_reels", sa.Integer(), nullable=False),
        sa.Column("min_duration_seconds", sa.Float(), nullable=False),
        sa.Column("max_duration_seconds", sa.Float(), nullable=False),
        sa.Column("additional_instructions", sa.Text(), nullable=True),
        sa.Column("doctrinal_orientation", sa.String(length=500), nullable=True),
        sa.Column("progress", sa.Float(), nullable=False),
        sa.Column("chunk_count", sa.Integer(), nullable=False),
        sa.Column("chunks_completed", sa.Integer(), nullable=False),
        sa.Column("prompt_tokens", sa.Integer(), nullable=True),
        sa.Column("completion_tokens", sa.Integer(), nullable=True),
        sa.Column("total_tokens", sa.Integer(), nullable=True),
        sa.Column("rejected_count", sa.Integer(), nullable=False),
        sa.Column("notice", sa.Text(), nullable=True),
        sa.Column("error_message", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("finished_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["project_id"], ["projects.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    with op.batch_alter_table("analysis_jobs", schema=None) as batch_op:
        batch_op.create_index(
            batch_op.f("ix_analysis_jobs_project_id"), ["project_id"], unique=False
        )
        batch_op.create_index(batch_op.f("ix_analysis_jobs_status"), ["status"], unique=False)

    op.create_table(
        "analysis_candidates",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("job_id", sa.Uuid(), nullable=False),
        sa.Column("project_id", sa.Uuid(), nullable=False),
        sa.Column("rank", sa.Integer(), nullable=False),
        sa.Column(
            "status",
            sa.Enum(
                "pending", "accepted", "rejected",
                name="analysis_candidate_status", native_enum=False, length=16,
            ),
            nullable=False,
        ),
        sa.Column("title", sa.String(length=300), nullable=False),
        sa.Column("hook", sa.String(length=500), nullable=True),
        sa.Column("summary", sa.Text(), nullable=True),
        sa.Column("editorial_score", sa.Float(), nullable=False),
        sa.Column("confidence", sa.Float(), nullable=False),
        sa.Column("joined_script", sa.Text(), nullable=True),
        sa.Column("caption", sa.Text(), nullable=True),
        sa.Column("hashtags_json", sa.Text(), nullable=True),
        sa.Column("segments_json", sa.Text(), nullable=False),
        sa.Column("warnings_json", sa.Text(), nullable=True),
        sa.Column("removed_context_warning", sa.Text(), nullable=True),
        sa.Column("accepted_reel_id", sa.Uuid(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["accepted_reel_id"], ["reels.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["job_id"], ["analysis_jobs.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["project_id"], ["projects.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    with op.batch_alter_table("analysis_candidates", schema=None) as batch_op:
        batch_op.create_index(
            batch_op.f("ix_analysis_candidates_job_id"), ["job_id"], unique=False
        )
        batch_op.create_index(
            batch_op.f("ix_analysis_candidates_project_id"), ["project_id"], unique=False
        )
        batch_op.create_index(
            batch_op.f("ix_analysis_candidates_status"), ["status"], unique=False
        )


def downgrade() -> None:
    with op.batch_alter_table("analysis_candidates", schema=None) as batch_op:
        batch_op.drop_index(batch_op.f("ix_analysis_candidates_status"))
        batch_op.drop_index(batch_op.f("ix_analysis_candidates_project_id"))
        batch_op.drop_index(batch_op.f("ix_analysis_candidates_job_id"))
    op.drop_table("analysis_candidates")

    with op.batch_alter_table("analysis_jobs", schema=None) as batch_op:
        batch_op.drop_index(batch_op.f("ix_analysis_jobs_status"))
        batch_op.drop_index(batch_op.f("ix_analysis_jobs_project_id"))
    op.drop_table("analysis_jobs")
