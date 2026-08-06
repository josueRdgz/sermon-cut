"""Persisted jobs for local, conservative audio repair."""

from __future__ import annotations

import enum
import uuid
from datetime import UTC, datetime

from sqlalchemy import DateTime, Enum, Float, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.types import Uuid

from app.db.base import Base


def _utc_now() -> datetime:
    return datetime.now(UTC)


class AudioRepairJobStatus(enum.StrEnum):
    queued = "queued"
    running = "running"
    cancelling = "cancelling"
    cancelled = "cancelled"
    completed = "completed"
    failed = "failed"


ACTIVE_AUDIO_REPAIR_STATUSES: frozenset[AudioRepairJobStatus] = frozenset(
    {
        AudioRepairJobStatus.queued,
        AudioRepairJobStatus.running,
        AudioRepairJobStatus.cancelling,
    }
)


class AudioRepairJob(Base):
    """Analysis/repair state polled by the frontend."""

    __tablename__ = "audio_repair_jobs"

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    project_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("projects.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    status: Mapped[AudioRepairJobStatus] = mapped_column(
        Enum(AudioRepairJobStatus, name="audio_repair_job_status", native_enum=False, length=32),
        nullable=False,
        default=AudioRepairJobStatus.queued,
        index=True,
    )
    stage: Mapped[str | None] = mapped_column(String(64), nullable=True)
    progress: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)

    silence_threshold: Mapped[int] = mapped_column(Integer, nullable=False, default=8)
    min_dropout_ms: Mapped[float] = mapped_column(Float, nullable=False, default=2.0)
    max_auto_repair_ms: Mapped[float] = mapped_column(Float, nullable=False, default=200.0)
    max_review_ms: Mapped[float] = mapped_column(Float, nullable=False, default=250.0)

    issue_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    repaired_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    review_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    issues_json: Mapped[str] = mapped_column(Text, nullable=False, default="[]")

    repaired_audio_filename: Mapped[str | None] = mapped_column(String(255), nullable=True)
    repaired_video_filename: Mapped[str | None] = mapped_column(String(255), nullable=True)
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=_utc_now
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=_utc_now, onupdate=_utc_now
    )
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
