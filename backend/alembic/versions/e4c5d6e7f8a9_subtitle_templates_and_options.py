"""subtitle templates and reel subtitle options

Revision ID: e4c5d6e7f8a9
Revises: d3b4c5d6e7f8
Create Date: 2026-07-24 14:40:00.000000

"""
from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "e4c5d6e7f8a9"
down_revision: str | None = "d3b4c5d6e7f8"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


_STYLE_MAP = {
    "default": "reformed_sober",
    "bold": "modern_highlight",
    "caption": "clear_reading",
}


def upgrade() -> None:
    with op.batch_alter_table("reels", schema=None) as batch_op:
        batch_op.add_column(
            sa.Column("subtitle_enabled", sa.Boolean(), nullable=False, server_default=sa.true())
        )
        batch_op.add_column(
            sa.Column(
                "subtitle_granularity",
                sa.Enum(
                    "auto",
                    "segment",
                    "phrase",
                    "word",
                    name="subtitle_granularity",
                    native_enum=False,
                    length=16,
                ),
                nullable=False,
                server_default="auto",
            )
        )
        batch_op.add_column(
            sa.Column("subtitle_font_size", sa.Integer(), nullable=False, server_default="52")
        )
        batch_op.add_column(
            sa.Column(
                "subtitle_position",
                sa.Enum(
                    "bottom",
                    "center",
                    "top",
                    name="subtitle_position",
                    native_enum=False,
                    length=16,
                ),
                nullable=False,
                server_default="bottom",
            )
        )
        batch_op.add_column(
            sa.Column(
                "subtitle_uppercase", sa.Boolean(), nullable=False, server_default=sa.false()
            )
        )
        batch_op.add_column(
            sa.Column("subtitle_max_words", sa.Integer(), nullable=False, server_default="6")
        )
        batch_op.add_column(
            sa.Column("subtitle_opacity", sa.Float(), nullable=False, server_default="1.0")
        )
        batch_op.add_column(
            sa.Column(
                "subtitle_margin_bottom", sa.Integer(), nullable=False, server_default="120"
            )
        )
        batch_op.add_column(sa.Column("subtitle_bible_reference", sa.String(length=200), nullable=True))

    # Remap legacy style names onto the new ASS templates.
    conn = op.get_bind()
    for old, new in _STYLE_MAP.items():
        conn.execute(
            sa.text("UPDATE reels SET subtitle_style = :new WHERE subtitle_style = :old"),
            {"old": old, "new": new},
        )


def downgrade() -> None:
    conn = op.get_bind()
    reverse = {v: k for k, v in _STYLE_MAP.items()}
    for new, old in reverse.items():
        conn.execute(
            sa.text("UPDATE reels SET subtitle_style = :old WHERE subtitle_style = :new"),
            {"old": old, "new": new},
        )
    conn.execute(
        sa.text(
            "UPDATE reels SET subtitle_style = 'default' "
            "WHERE subtitle_style = 'sermon_quote'"
        )
    )

    with op.batch_alter_table("reels", schema=None) as batch_op:
        batch_op.drop_column("subtitle_bible_reference")
        batch_op.drop_column("subtitle_margin_bottom")
        batch_op.drop_column("subtitle_opacity")
        batch_op.drop_column("subtitle_max_words")
        batch_op.drop_column("subtitle_uppercase")
        batch_op.drop_column("subtitle_position")
        batch_op.drop_column("subtitle_font_size")
        batch_op.drop_column("subtitle_granularity")
        batch_op.drop_column("subtitle_enabled")
