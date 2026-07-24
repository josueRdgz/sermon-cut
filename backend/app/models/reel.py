"""ORM models for reels composed of non-consecutive source segments."""

from __future__ import annotations

import enum
import uuid
from datetime import UTC, datetime

from sqlalchemy import DateTime, Enum, Float, ForeignKey, Integer, String, Text
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


class SubtitleStyle(enum.StrEnum):
    """Initial subtitle style presets (rendering comes later)."""

    default = "default"
    bold = "bold"
    caption = "caption"


class ReelStatus(enum.StrEnum):
    """Lifecycle of a Reel edit (no file rendering yet)."""

    draft = "draft"
    ready = "ready"
    rendering = "rendering"
    completed = "completed"
    failed = "failed"


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

    subtitle_style: Mapped[SubtitleStyle] = mapped_column(
        Enum(SubtitleStyle, name="subtitle_style", native_enum=False, length=32),
        nullable=False,
        default=SubtitleStyle.default,
    )
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

    reel: Mapped[Reel] = relationship(back_populates="segments")
