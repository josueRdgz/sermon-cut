"""ORM models for transcripts and timed segments/words."""

from __future__ import annotations

import enum
import uuid
from datetime import UTC, datetime

from sqlalchemy import (
    Boolean,
    DateTime,
    Enum,
    Float,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.types import Uuid

from app.db.base import Base


def _utc_now() -> datetime:
    return datetime.now(UTC)


class TranscriptSource(enum.StrEnum):
    """Origin of a transcript."""

    uploaded_srt = "uploaded_srt"
    uploaded_vtt = "uploaded_vtt"
    uploaded_json = "uploaded_json"
    uploaded_txt = "uploaded_txt"
    whisper = "whisper"
    youtube = "youtube"
    manual = "manual"


class TranscriptStatus(enum.StrEnum):
    """Import / sync state of a transcript."""

    ready = "ready"  # timed segments available
    unsynced = "unsynced"  # text without reliable timestamps (e.g. plain TXT)
    failed = "failed"


class Transcript(Base):
    """Normalized transcript belonging to a single project.

    One active transcript per project (enforced by a unique constraint).
    Binary source files are optional; the canonical data lives in segments.
    """

    __tablename__ = "transcripts"
    __table_args__ = (UniqueConstraint("project_id", name="uq_transcripts_project_id"),)

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    project_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("projects.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    source: Mapped[TranscriptSource] = mapped_column(
        Enum(TranscriptSource, name="transcript_source", native_enum=False, length=32),
        nullable=False,
    )
    language: Mapped[str | None] = mapped_column(String(16), nullable=True)
    status: Mapped[TranscriptStatus] = mapped_column(
        Enum(TranscriptStatus, name="transcript_status", native_enum=False, length=32),
        nullable=False,
        default=TranscriptStatus.ready,
    )
    full_text: Mapped[str] = mapped_column(Text, nullable=False, default="")
    original_full_text: Mapped[str] = mapped_column(Text, nullable=False, default="")
    has_word_timestamps: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=_utc_now
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=_utc_now, onupdate=_utc_now
    )

    segments: Mapped[list[TranscriptSegment]] = relationship(
        back_populates="transcript",
        cascade="all, delete-orphan",
        order_by="TranscriptSegment.order",
    )


class TranscriptSegment(Base):
    """A contiguous span of transcript text, optionally timed."""

    __tablename__ = "transcript_segments"

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    transcript_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("transcripts.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    order: Mapped[int] = mapped_column(Integer, nullable=False)
    start_seconds: Mapped[float | None] = mapped_column(Float, nullable=True)
    end_seconds: Mapped[float | None] = mapped_column(Float, nullable=True)
    text: Mapped[str] = mapped_column(Text, nullable=False)
    original_text: Mapped[str] = mapped_column(Text, nullable=False, default="")

    transcript: Mapped[Transcript] = relationship(back_populates="segments")
    words: Mapped[list[TranscriptWord]] = relationship(
        back_populates="segment",
        cascade="all, delete-orphan",
        order_by="TranscriptWord.order",
    )


class TranscriptWord(Base):
    """Optional word-level timing within a segment."""

    __tablename__ = "transcript_words"

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    transcript_segment_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("transcript_segments.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    order: Mapped[int] = mapped_column(Integer, nullable=False)
    start_seconds: Mapped[float | None] = mapped_column(Float, nullable=True)
    end_seconds: Mapped[float | None] = mapped_column(Float, nullable=True)
    text: Mapped[str] = mapped_column(Text, nullable=False)
    confidence: Mapped[float | None] = mapped_column(Float, nullable=True)

    segment: Mapped[TranscriptSegment] = relationship(back_populates="words")
