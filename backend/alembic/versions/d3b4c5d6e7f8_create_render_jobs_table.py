"""create_render_jobs_table

Revision ID: d3b4c5d6e7f8
Revises: c2a3b4c5d6e7
Create Date: 2026-07-24 14:20:00.000000

"""
from __future__ import annotations

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa


revision: str = 'd3b4c5d6e7f8'
down_revision: str | None = 'c2a3b4c5d6e7'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        'render_jobs',
        sa.Column('id', sa.Uuid(), nullable=False),
        sa.Column('project_id', sa.Uuid(), nullable=False),
        sa.Column('reel_id', sa.Uuid(), nullable=False),
        sa.Column(
            'status',
            sa.Enum(
                'queued', 'running', 'cancelling', 'cancelled', 'completed', 'failed',
                name='render_job_status', native_enum=False, length=32,
            ),
            nullable=False,
        ),
        sa.Column('stage', sa.String(length=64), nullable=True),
        sa.Column('aspect_ratio', sa.String(length=16), nullable=False),
        sa.Column('layout', sa.String(length=32), nullable=False),
        sa.Column('width', sa.Integer(), nullable=True),
        sa.Column('height', sa.Integer(), nullable=True),
        sa.Column('fps', sa.Float(), nullable=True),
        sa.Column('progress', sa.Float(), nullable=False),
        sa.Column('processed_seconds', sa.Float(), nullable=False),
        sa.Column('total_seconds', sa.Float(), nullable=True),
        sa.Column('speed', sa.Float(), nullable=True),
        sa.Column('output_filename', sa.String(length=255), nullable=True),
        sa.Column('output_size_bytes', sa.BigInteger(), nullable=True),
        sa.Column('ffmpeg_command', sa.Text(), nullable=True),
        sa.Column('error_message', sa.Text(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('started_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('finished_at', sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(['project_id'], ['projects.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['reel_id'], ['reels.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
    )
    with op.batch_alter_table('render_jobs', schema=None) as batch_op:
        batch_op.create_index(
            batch_op.f('ix_render_jobs_project_id'), ['project_id'], unique=False
        )
        batch_op.create_index(batch_op.f('ix_render_jobs_reel_id'), ['reel_id'], unique=False)
        batch_op.create_index(batch_op.f('ix_render_jobs_status'), ['status'], unique=False)


def downgrade() -> None:
    with op.batch_alter_table('render_jobs', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_render_jobs_status'))
        batch_op.drop_index(batch_op.f('ix_render_jobs_reel_id'))
        batch_op.drop_index(batch_op.f('ix_render_jobs_project_id'))

    op.drop_table('render_jobs')
