"""ORM model for end card settings (global default + per-project override).

Every Reel render ends with a mandatory end card. A single row with
``project_id IS NULL`` holds the global defaults; a row with a ``project_id``
overrides them for that project.
"""

from __future__ import annotations

import enum
import uuid
from datetime import UTC, datetime

from sqlalchemy import Boolean, DateTime, Enum, Float, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.types import Uuid

from app.db.base import Base

# The end card is mandatory; these bounds are enforced everywhere.
MIN_END_CARD_SECONDS = 3.0
MAX_END_CARD_SECONDS = 8.0
DEFAULT_END_CARD_SECONDS = 5.0
DEFAULT_FADE_IN_MS = 300
DEFAULT_AUDIO_FADE_OUT_MS = 500

CALL_TO_ACTION_TEXT = "Ver sermón completo en nuestro canal de YouTube"


def _utc_now() -> datetime:
    return datetime.now(UTC)


class EndCardLayout(enum.StrEnum):
    """Visual designs for the end card."""

    cover_full = "cover_full"
    cover_card = "cover_card"
    minimal = "minimal"


class EndCardAudioMode(enum.StrEnum):
    """What the audio track does during the end card."""

    silence = "silence"
    continue_with_fade = "continue_with_fade"
    local_music = "local_music"


class EndCardSettings(Base):
    """Configuration for the mandatory end card.

    ``project_id`` is ``NULL`` for the global default row.
    """

    __tablename__ = "end_card_settings"

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    # NULL == global defaults. Unique so there is at most one row per scope.
    project_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("projects.id", ondelete="CASCADE"),
        nullable=True,
        unique=True,
        index=True,
    )

    layout: Mapped[EndCardLayout] = mapped_column(
        Enum(EndCardLayout, name="end_card_layout", native_enum=False, length=32),
        nullable=False,
        default=EndCardLayout.cover_full,
    )
    duration_seconds: Mapped[float] = mapped_column(
        Float, nullable=False, default=DEFAULT_END_CARD_SECONDS
    )
    fade_in_ms: Mapped[int] = mapped_column(Integer, nullable=False, default=DEFAULT_FADE_IN_MS)
    audio_fade_out_ms: Mapped[int] = mapped_column(
        Integer, nullable=False, default=DEFAULT_AUDIO_FADE_OUT_MS
    )
    audio_mode: Mapped[EndCardAudioMode] = mapped_column(
        Enum(EndCardAudioMode, name="end_card_audio_mode", native_enum=False, length=32),
        nullable=False,
        default=EndCardAudioMode.continue_with_fade,
    )
    # User-provided music file inside the project dir. Never downloaded.
    music_filename: Mapped[str | None] = mapped_column(String(255), nullable=True)
    music_volume: Mapped[float] = mapped_column(Float, nullable=False, default=0.6)

    # Optional extras.
    logo_filename: Mapped[str | None] = mapped_column(String(255), nullable=True)
    url_text: Mapped[str | None] = mapped_column(String(500), nullable=True)
    show_qr: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    qr_url: Mapped[str | None] = mapped_column(String(500), nullable=True)
    # Overrides the project's own channel/church strings when set.
    channel_handle: Mapped[str | None] = mapped_column(String(200), nullable=True)
    custom_message: Mapped[str | None] = mapped_column(Text, nullable=True)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=_utc_now
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=_utc_now, onupdate=_utc_now
    )
