"""Add horizontal Video Highlights and shared publishing metadata.

Revision ID: b3c4d5e6f7a8
Revises: a2b3c4d5e6f7
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "b3c4d5e6f7a8"
down_revision: str | None = "a2b3c4d5e6f7"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    with op.batch_alter_table("projects") as batch:
        batch.add_column(
            sa.Column("content_mode", sa.String(length=24), nullable=False, server_default="shorts")
        )
    with op.batch_alter_table("transcripts") as batch:
        batch.add_column(
            sa.Column("original_full_text", sa.Text(), nullable=False, server_default="")
        )
    with op.batch_alter_table("transcript_segments") as batch:
        batch.add_column(sa.Column("original_text", sa.Text(), nullable=False, server_default=""))
    op.execute("UPDATE transcripts SET original_full_text = full_text")
    op.execute("UPDATE transcript_segments SET original_text = text")
    with op.batch_alter_table("reels") as batch:
        batch.add_column(
            sa.Column("content_kind", sa.String(length=16), nullable=False, server_default="short")
        )
        batch.create_index("ix_reels_content_kind", ["content_kind"], unique=False)
    with op.batch_alter_table("reel_segments") as batch:
        batch.add_column(sa.Column("selection_reason", sa.Text(), nullable=True))
        batch.add_column(sa.Column("selection_score", sa.Float(), nullable=True))
        batch.add_column(sa.Column("narrative_category", sa.String(length=32), nullable=True))
    with op.batch_alter_table("analysis_candidates") as batch:
        batch.add_column(sa.Column("suggested_titles_json", sa.Text(), nullable=True))
        batch.add_column(sa.Column("thumbnail_text", sa.String(length=120), nullable=True))
        batch.add_column(sa.Column("keywords_json", sa.Text(), nullable=True))

    op.create_table(
        "highlight_plans",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("project_id", sa.Uuid(), nullable=False),
        sa.Column("reel_id", sa.Uuid(), nullable=True),
        sa.Column("sermon_start_seconds", sa.Float(), nullable=True),
        sa.Column("sermon_end_seconds", sa.Float(), nullable=True),
        sa.Column("sermon_confidence", sa.Float(), nullable=True),
        sa.Column("sermon_detection_method", sa.String(length=64), nullable=True),
        sa.Column("sermon_detection_notes", sa.Text(), nullable=True),
        sa.Column("target_duration_seconds", sa.Integer(), nullable=False),
        sa.Column("editorial_style", sa.String(length=32), nullable=False),
        sa.Column("subtitle_delivery", sa.String(length=16), nullable=False),
        sa.Column("title_theme", sa.String(length=300), nullable=True),
        sa.Column("biblical_references_json", sa.Text(), nullable=True),
        sa.Column("regeneration_history_json", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["project_id"], ["projects.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["reel_id"], ["reels.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("project_id", name="uq_highlight_plans_project_id"),
        sa.UniqueConstraint("reel_id"),
    )
    op.create_index("ix_highlight_plans_project_id", "highlight_plans", ["project_id"])

    op.create_table(
        "content_metadata",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("project_id", sa.Uuid(), nullable=False),
        sa.Column("reel_id", sa.Uuid(), nullable=False),
        sa.Column("content_kind", sa.String(length=16), nullable=False),
        sa.Column("suggested_titles_json", sa.Text(), nullable=False),
        sa.Column("chosen_title", sa.String(length=300), nullable=True),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("thumbnail_text", sa.String(length=120), nullable=True),
        sa.Column("hashtags_json", sa.Text(), nullable=False),
        sa.Column("keywords_json", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["project_id"], ["projects.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["reel_id"], ["reels.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("reel_id", name="uq_content_metadata_reel_id"),
    )
    op.create_index("ix_content_metadata_project_id", "content_metadata", ["project_id"])
    op.create_index("ix_content_metadata_reel_id", "content_metadata", ["reel_id"])

    op.create_table(
        "highlight_analysis_jobs",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("project_id", sa.Uuid(), nullable=False),
        sa.Column("plan_id", sa.Uuid(), nullable=False),
        sa.Column("status", sa.String(length=32), nullable=False),
        sa.Column("stage", sa.String(length=64), nullable=True),
        sa.Column("provider", sa.String(length=32), nullable=False),
        sa.Column("target_duration_seconds", sa.Integer(), nullable=False),
        sa.Column("editorial_style", sa.String(length=32), nullable=False),
        sa.Column("progress", sa.Float(), nullable=False),
        sa.Column("prompt_tokens", sa.Integer(), nullable=True),
        sa.Column("completion_tokens", sa.Integer(), nullable=True),
        sa.Column("total_tokens", sa.Integer(), nullable=True),
        sa.Column("error_message", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("finished_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["plan_id"], ["highlight_plans.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["project_id"], ["projects.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_highlight_analysis_jobs_project_id",
        "highlight_analysis_jobs",
        ["project_id"],
    )
    op.create_index(
        "ix_highlight_analysis_jobs_plan_id",
        "highlight_analysis_jobs",
        ["plan_id"],
    )
    op.create_index(
        "ix_highlight_analysis_jobs_status",
        "highlight_analysis_jobs",
        ["status"],
    )


def downgrade() -> None:
    op.drop_table("highlight_analysis_jobs")
    op.drop_table("content_metadata")
    op.drop_table("highlight_plans")
    with op.batch_alter_table("analysis_candidates") as batch:
        batch.drop_column("keywords_json")
        batch.drop_column("thumbnail_text")
        batch.drop_column("suggested_titles_json")
    with op.batch_alter_table("reel_segments") as batch:
        batch.drop_column("narrative_category")
        batch.drop_column("selection_score")
        batch.drop_column("selection_reason")
    with op.batch_alter_table("reels") as batch:
        batch.drop_index("ix_reels_content_kind")
        batch.drop_column("content_kind")
    with op.batch_alter_table("projects") as batch:
        batch.drop_column("content_mode")
    with op.batch_alter_table("transcript_segments") as batch:
        batch.drop_column("original_text")
    with op.batch_alter_table("transcripts") as batch:
        batch.drop_column("original_full_text")
