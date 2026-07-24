"""create_reels_tables

Revision ID: c2a3b4c5d6e7
Revises: b1f2c3d4e5a6
Create Date: 2026-07-24 13:40:00.000000

"""
from __future__ import annotations

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa


revision: str = 'c2a3b4c5d6e7'
down_revision: str | None = 'b1f2c3d4e5a6'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        'reels',
        sa.Column('id', sa.Uuid(), nullable=False),
        sa.Column('project_id', sa.Uuid(), nullable=False),
        sa.Column('title', sa.String(length=300), nullable=False),
        sa.Column('hook', sa.String(length=500), nullable=True),
        sa.Column('description', sa.Text(), nullable=True),
        sa.Column('editorial_score', sa.Float(), nullable=True),
        sa.Column(
            'subtitle_style',
            sa.Enum('default', 'bold', 'caption', name='subtitle_style', native_enum=False, length=32),
            nullable=False,
        ),
        sa.Column(
            'aspect_ratio',
            sa.Enum('9:16', '1:1', '16:9', name='aspect_ratio', native_enum=False, length=16),
            nullable=False,
        ),
        sa.Column(
            'status',
            sa.Enum(
                'draft', 'ready', 'rendering', 'completed', 'failed',
                name='reel_status', native_enum=False, length=32,
            ),
            nullable=False,
        ),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(['project_id'], ['projects.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
    )
    with op.batch_alter_table('reels', schema=None) as batch_op:
        batch_op.create_index(batch_op.f('ix_reels_project_id'), ['project_id'], unique=False)

    op.create_table(
        'reel_segments',
        sa.Column('id', sa.Uuid(), nullable=False),
        sa.Column('reel_id', sa.Uuid(), nullable=False),
        sa.Column('order', sa.Integer(), nullable=False),
        sa.Column('source_start_seconds', sa.Float(), nullable=False),
        sa.Column('source_end_seconds', sa.Float(), nullable=False),
        sa.Column('transcript_text', sa.Text(), nullable=True),
        sa.Column(
            'transition_type',
            sa.Enum(
                'hard_cut', 'short_crossfade', 'dip_to_black',
                name='transition_type', native_enum=False, length=32,
            ),
            nullable=False,
        ),
        sa.Column('transition_duration_ms', sa.Integer(), nullable=False),
        sa.ForeignKeyConstraint(['reel_id'], ['reels.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
    )
    with op.batch_alter_table('reel_segments', schema=None) as batch_op:
        batch_op.create_index(batch_op.f('ix_reel_segments_reel_id'), ['reel_id'], unique=False)


def downgrade() -> None:
    with op.batch_alter_table('reel_segments', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_reel_segments_reel_id'))
    op.drop_table('reel_segments')

    with op.batch_alter_table('reels', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_reels_project_id'))
    op.drop_table('reels')
