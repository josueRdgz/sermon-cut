"""ORM models for reels composed of non-consecutive source segments."""

from __future__ import annotations

import enum
import uuid
from datetime import UTC, datetime

from sqlalchemy import Boolean, DateTime, Enum, Float, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.types import Uuid

from app.db.base import Base


def _utc_now() -> datetime:
    return datetime.now(UTC)


class AspectRatio(enum.StrEnum):
    """Output aspect ratios supported for a Reel."""

    nine_sixteen = "9:16"
    one_one = "1:1"
    sixteen_nine = "16:9"


class TransitionType(enum.StrEnum):
    """Transition applied *after* a ReelSegment (before the next one)."""

    hard_cut = "hard_cut"
    short_crossfade = "short_crossfade"
    dip_to_black = "dip_to_black"
    fade = "fade"
    flash = "flash"


class SubtitleStyle(enum.StrEnum):
    """ASS subtitle templates burned into the rendered reel."""

    reformed_sober = "reformed_sober"
    modern_highlight = "modern_highlight"
    clear_reading = "clear_reading"
    sermon_quote = "sermon_quote"


class SubtitleGranularity(enum.StrEnum):
    auto = "auto"
    segment = "segment"
    phrase = "phrase"
    word = "word"


class SubtitlePosition(enum.StrEnum):
    bottom = "bottom"
    center = "center"
    top = "top"


class ReelStatus(enum.StrEnum):
    """Lifecycle of a Reel edit."""

    draft = "draft"
    ready = "ready"
    rendering = "rendering"
    completed = "completed"
    failed = "failed"


class ContentKind(enum.StrEnum):
    """Editorial product represented by the shared timeline editor."""

    short = "short"
    highlight = "highlight"


class Reel(Base):
    """A vertical (or other ratio) edit built from ordered, possibly non-contiguous clips.

    A Reel is *not* a single contiguous range. It is an ordered list of
    ``ReelSegment`` windows into the source video that may leave gaps between them.
    """

    __tablename__ = "reels"

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    project_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("projects.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    title: Mapped[str] = mapped_column(String(300), nullable=False)
    hook: Mapped[str | None] = mapped_column(String(500), nullable=True)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    editorial_score: Mapped[float | None] = mapped_column(Float, nullable=True)
    content_kind: Mapped[ContentKind] = mapped_column(
        Enum(ContentKind, name="content_kind", native_enum=False, length=16),
        nullable=False,
        default=ContentKind.short,
        index=True,
    )

    subtitle_style: Mapped[SubtitleStyle] = mapped_column(
        Enum(SubtitleStyle, name="subtitle_style", native_enum=False, length=32),
        nullable=False,
        default=SubtitleStyle.reformed_sober,
    )
    subtitle_enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    subtitle_granularity: Mapped[SubtitleGranularity] = mapped_column(
        Enum(SubtitleGranularity, name="subtitle_granularity", native_enum=False, length=16),
        nullable=False,
        default=SubtitleGranularity.auto,
    )
    subtitle_font_size: Mapped[int] = mapped_column(Integer, nullable=False, default=52)
    subtitle_position: Mapped[SubtitlePosition] = mapped_column(
        Enum(SubtitlePosition, name="subtitle_position", native_enum=False, length=16),
        nullable=False,
        default=SubtitlePosition.bottom,
    )
    subtitle_uppercase: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    subtitle_max_words: Mapped[int] = mapped_column(Integer, nullable=False, default=6)
    subtitle_opacity: Mapped[float] = mapped_column(Float, nullable=False, default=1.0)
    subtitle_margin_bottom: Mapped[int] = mapped_column(Integer, nullable=False, default=120)
    subtitle_bible_reference: Mapped[str | None] = mapped_column(String(200), nullable=True)

    aspect_ratio: Mapped[AspectRatio] = mapped_column(
        Enum(AspectRatio, name="aspect_ratio", native_enum=False, length=16),
        nullable=False,
        default=AspectRatio.nine_sixteen,
    )
    status: Mapped[ReelStatus] = mapped_column(
        Enum(ReelStatus, name="reel_status", native_enum=False, length=32),
        nullable=False,
        default=ReelStatus.draft,
    )

    # JSON list of ignored coherence warnings: [{code, segment_id, segment_uuid?}].
    coherence_dismissals_json: Mapped[str | None] = mapped_column(Text, nullable=True)
    # Last generated technical cut suggestions (pending / accepted / rejected).
    cut_suggestions_json: Mapped[str | None] = mapped_column(Text, nullable=True)
    # Vertical framing mode for renders: center_crop | blurred_background | auto_track | manual.
    framing_mode: Mapped[str] = mapped_column(
        String(32), nullable=False, default="center_crop"
    )
    # Positive values delay audio; negative values advance it.
    audio_offset_ms: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=_utc_now
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=_utc_now, onupdate=_utc_now
    )

    segments: Mapped[list[ReelSegment]] = relationship(
        back_populates="reel",
        cascade="all, delete-orphan",
        order_by="ReelSegment.order",
    )
    overlays: Mapped[list["ReelOverlay"]] = relationship(
        "ReelOverlay",
        back_populates="reel",
        cascade="all, delete-orphan",
        order_by="ReelOverlay.order",
    )


class ReelSegment(Base):
    """One source window inside a Reel.

    Segments are ordered by ``order`` and need not be contiguous in the source:
    ``[10–20]`` then ``[45–60]`` is valid and intentional.
    """

    __tablename__ = "reel_segments"

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    reel_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("reels.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    order: Mapped[int] = mapped_column(Integer, nullable=False)

    source_start_seconds: Mapped[float] = mapped_column(Float, nullable=False)
    source_end_seconds: Mapped[float] = mapped_column(Float, nullable=False)
    transcript_text: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Transition applied after this segment when playing/rendering the next one.
    # The last segment's transition is ignored for duration (nothing follows).
    transition_type: Mapped[TransitionType] = mapped_column(
        Enum(TransitionType, name="transition_type", native_enum=False, length=32),
        nullable=False,
        default=TransitionType.hard_cut,
    )
    transition_duration_ms: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    # Optional manual crop (normalized subject center 0–1) for framing_mode=manual.
    manual_crop_x: Mapped[float | None] = mapped_column(Float, nullable=True)
    manual_crop_y: Mapped[float | None] = mapped_column(Float, nullable=True)
    manual_crop_zoom: Mapped[float | None] = mapped_column(Float, nullable=True)
    selection_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    selection_score: Mapped[float | None] = mapped_column(Float, nullable=True)
    narrative_category: Mapped[str | None] = mapped_column(String(32), nullable=True)
    # Independent subtitle window on the output clock (ms). None = follow the video clip.
    caption_in_ms: Mapped[int | None] = mapped_column(Integer, nullable=True)
    caption_out_ms: Mapped[int | None] = mapped_column(Integer, nullable=True)

    reel: Mapped[Reel] = relationship(back_populates="segments")
