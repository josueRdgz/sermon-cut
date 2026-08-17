"""create project_assets and reel_overlays tables

Revision ID: f6a7b8c9d0e1
Revises: e6f7a8b9c0d1
Create Date: 2026-08-14 15:30:00.000000

"""
from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "f6a7b8c9d0e1"
down_revision: str | None = "e6f7a8b9c0d1"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "project_assets",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("project_id", sa.Uuid(), nullable=False),
        sa.Column(
            "kind",
            sa.Enum(
                "image",
                "audio",
                "other",
                name="project_asset_kind",
                native_enum=False,
                length=16,
            ),
            nullable=False,
        ),
        sa.Column("filename", sa.String(length=255), nullable=False),
        sa.Column("storage_path", sa.String(length=512), nullable=False),
        sa.Column("original_name", sa.String(length=300), nullable=True),
        sa.Column("width", sa.Integer(), nullable=True),
        sa.Column("height", sa.Integer(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["project_id"], ["projects.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    with op.batch_alter_table("project_assets", schema=None) as batch_op:
        batch_op.create_index(
            batch_op.f("ix_project_assets_project_id"),
            ["project_id"],
            unique=False,
        )

    op.create_table(
        "reel_overlays",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("reel_id", sa.Uuid(), nullable=False),
        sa.Column(
            "kind",
            sa.Enum(
                "image",
                "text",
                name="reel_overlay_kind",
                native_enum=False,
                length=16,
            ),
            nullable=False,
        ),
        sa.Column("asset_id", sa.Uuid(), nullable=True),
        sa.Column("text", sa.Text(), nullable=True),
        sa.Column("style_json", sa.Text(), nullable=True),
        sa.Column("start_ms", sa.Integer(), nullable=False),
        sa.Column("duration_ms", sa.Integer(), nullable=False),
        sa.Column("x", sa.Float(), nullable=False),
        sa.Column("y", sa.Float(), nullable=False),
        sa.Column("scale", sa.Float(), nullable=False),
        sa.Column("opacity", sa.Float(), nullable=False),
        sa.Column("z_index", sa.Integer(), nullable=False),
        sa.Column("order", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["asset_id"], ["project_assets.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["reel_id"], ["reels.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    with op.batch_alter_table("reel_overlays", schema=None) as batch_op:
        batch_op.create_index(
            batch_op.f("ix_reel_overlays_reel_id"),
            ["reel_id"],
            unique=False,
        )
        batch_op.create_index(
            batch_op.f("ix_reel_overlays_asset_id"),
            ["asset_id"],
            unique=False,
        )


def downgrade() -> None:
    with op.batch_alter_table("reel_overlays", schema=None) as batch_op:
        batch_op.drop_index(batch_op.f("ix_reel_overlays_asset_id"))
        batch_op.drop_index(batch_op.f("ix_reel_overlays_reel_id"))
    op.drop_table("reel_overlays")
    with op.batch_alter_table("project_assets", schema=None) as batch_op:
        batch_op.drop_index(batch_op.f("ix_project_assets_project_id"))
    op.drop_table("project_assets")
