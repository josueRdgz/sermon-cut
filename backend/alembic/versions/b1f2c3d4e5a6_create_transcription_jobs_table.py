"""create_transcription_jobs_table

Revision ID: b1f2c3d4e5a6
Revises: 904cb8e88d3f
Create Date: 2026-07-24 13:30:00.000000

"""
from __future__ import annotations

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'b1f2c3d4e5a6'
down_revision: str | None = '904cb8e88d3f'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        'transcription_jobs',
        sa.Column('id', sa.Uuid(), nullable=False),
        sa.Column('project_id', sa.Uuid(), nullable=False),
        sa.Column(
            'status',
            sa.Enum(
                'queued', 'running', 'cancelling', 'cancelled', 'completed', 'failed',
                name='transcription_job_status', native_enum=False, length=32,
            ),
            nullable=False,
        ),
        sa.Column('stage', sa.String(length=64), nullable=True),
        sa.Column('model_name', sa.String(length=32), nullable=False),
        sa.Column('language_option', sa.String(length=16), nullable=False),
        sa.Column('detected_language', sa.String(length=16), nullable=True),
        sa.Column('device', sa.String(length=16), nullable=True),
        sa.Column('compute_type', sa.String(length=32), nullable=True),
        sa.Column('notice', sa.Text(), nullable=True),
        sa.Column('progress', sa.Float(), nullable=False),
        sa.Column('processed_seconds', sa.Float(), nullable=False),
        sa.Column('total_seconds', sa.Float(), nullable=True),
        sa.Column('error_message', sa.Text(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('started_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('finished_at', sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(['project_id'], ['projects.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
    )
    with op.batch_alter_table('transcription_jobs', schema=None) as batch_op:
        batch_op.create_index(
            batch_op.f('ix_transcription_jobs_project_id'), ['project_id'], unique=False
        )
        batch_op.create_index(
            batch_op.f('ix_transcription_jobs_status'), ['status'], unique=False
        )


def downgrade() -> None:
    with op.batch_alter_table('transcription_jobs', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_transcription_jobs_status'))
        batch_op.drop_index(batch_op.f('ix_transcription_jobs_project_id'))

    op.drop_table('transcription_jobs')
