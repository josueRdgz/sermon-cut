"""Persistent sermon-range, highlight-analysis and publishing metadata models."""

from __future__ import annotations

import enum
import uuid
from datetime import UTC, datetime

from sqlalchemy import DateTime, Enum, Float, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.types import Uuid

from app.db.base import Base


def _utc_now() -> datetime:
    return datetime.now(UTC)


class HighlightAnalysisStatus(enum.StrEnum):
    queued = "queued"
    running = "running"
    cancelling = "cancelling"
    cancelled = "cancelled"
    completed = "completed"
    failed = "failed"


ACTIVE_HIGHLIGHT_STATUSES: frozenset[HighlightAnalysisStatus] = frozenset(
    {
        HighlightAnalysisStatus.queued,
        HighlightAnalysisStatus.running,
        HighlightAnalysisStatus.cancelling,
    }
)


class SubtitleDelivery(enum.StrEnum):
    none = "none"
    burned = "burned"
    srt = "srt"
    both = "both"


class HighlightPlan(Base):
    """One persisted horizontal highlights edit per source project."""

    __tablename__ = "highlight_plans"
    __table_args__ = (UniqueConstraint("project_id", name="uq_highlight_plans_project_id"),)

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    project_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("projects.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    reel_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("reels.id", ondelete="SET NULL"),
        nullable=True,
        unique=True,
    )
    sermon_start_seconds: Mapped[float | None] = mapped_column(Float, nullable=True)
    sermon_end_seconds: Mapped[float | None] = mapped_column(Float, nullable=True)
    sermon_confidence: Mapped[float | None] = mapped_column(Float, nullable=True)
    sermon_detection_method: Mapped[str | None] = mapped_column(String(64), nullable=True)
    sermon_detection_notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    target_duration_seconds: Mapped[int] = mapped_column(Integer, nullable=False, default=300)
    editorial_style: Mapped[str] = mapped_column(String(32), nullable=False, default="balanced")
    subtitle_delivery: Mapped[SubtitleDelivery] = mapped_column(
        Enum(SubtitleDelivery, name="highlight_subtitle_delivery", native_enum=False, length=16),
        nullable=False,
        default=SubtitleDelivery.burned,
    )
    title_theme: Mapped[str | None] = mapped_column(String(300), nullable=True)
    biblical_references_json: Mapped[str | None] = mapped_column(Text, nullable=True)
    regeneration_history_json: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=_utc_now
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=_utc_now, onupdate=_utc_now
    )


class ContentMetadata(Base):
    """Strategic YouTube metadata shared by Shorts and Highlights."""

    __tablename__ = "content_metadata"
    __table_args__ = (UniqueConstraint("reel_id", name="uq_content_metadata_reel_id"),)

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    project_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("projects.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    reel_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("reels.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    content_kind: Mapped[str] = mapped_column(String(16), nullable=False)
    suggested_titles_json: Mapped[str] = mapped_column(Text, nullable=False, default="{}")
    chosen_title: Mapped[str | None] = mapped_column(String(300), nullable=True)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    thumbnail_text: Mapped[str | None] = mapped_column(String(120), nullable=True)
    hashtags_json: Mapped[str] = mapped_column(Text, nullable=False, default="[]")
    keywords_json: Mapped[str] = mapped_column(Text, nullable=False, default="[]")
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=_utc_now
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=_utc_now, onupdate=_utc_now
    )


class HighlightAnalysisJob(Base):
    """Persisted asynchronous semantic selection job."""

    __tablename__ = "highlight_analysis_jobs"

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    project_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("projects.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    plan_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("highlight_plans.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    status: Mapped[HighlightAnalysisStatus] = mapped_column(
        Enum(
            HighlightAnalysisStatus,
            name="highlight_analysis_status",
            native_enum=False,
            length=32,
        ),
        nullable=False,
        default=HighlightAnalysisStatus.queued,
        index=True,
    )
    stage: Mapped[str | None] = mapped_column(String(64), nullable=True)
    provider: Mapped[str] = mapped_column(String(32), nullable=False, default="gemini")
    target_duration_seconds: Mapped[int] = mapped_column(Integer, nullable=False)
    editorial_style: Mapped[str] = mapped_column(String(32), nullable=False)
    progress: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    prompt_tokens: Mapped[int | None] = mapped_column(Integer, nullable=True)
    completion_tokens: Mapped[int | None] = mapped_column(Integer, nullable=True)
    total_tokens: Mapped[int | None] = mapped_column(Integer, nullable=True)
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=_utc_now
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=_utc_now, onupdate=_utc_now
    )
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
