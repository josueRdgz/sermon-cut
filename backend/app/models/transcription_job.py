"""ORM model for local transcription jobs (faster-whisper)."""

from __future__ import annotations

import enum
import uuid
from datetime import UTC, datetime

from sqlalchemy import DateTime, Enum, Float, ForeignKey, String, Text
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.types import Uuid

from app.db.base import Base


def _utc_now() -> datetime:
    return datetime.now(UTC)


class TranscriptionJobStatus(enum.StrEnum):
    """Lifecycle of a local transcription job."""

    queued = "queued"
    running = "running"
    cancelling = "cancelling"
    cancelled = "cancelled"
    completed = "completed"
    failed = "failed"


# States in which a job is still occupying a worker / not final.
ACTIVE_JOB_STATUSES: frozenset[TranscriptionJobStatus] = frozenset(
    {
        TranscriptionJobStatus.queued,
        TranscriptionJobStatus.running,
        TranscriptionJobStatus.cancelling,
    }
)


class TranscriptionJob(Base):
    """Persisted state of a transcription task.

    The job state lives in SQLite so it survives across requests and can be
    polled by the frontend. No Celery/Redis: execution is handled by an
    in-process asyncio + ThreadPoolExecutor manager.
    """

    __tablename__ = "transcription_jobs"

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    project_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("projects.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    status: Mapped[TranscriptionJobStatus] = mapped_column(
        Enum(TranscriptionJobStatus, name="transcription_job_status", native_enum=False, length=32),
        nullable=False,
        default=TranscriptionJobStatus.queued,
        index=True,
    )
    # Human-readable current stage, e.g. "extracting_audio", "transcribing".
    stage: Mapped[str | None] = mapped_column(String(64), nullable=True)

    model_name: Mapped[str] = mapped_column(String(32), nullable=False)
    # Requested language option: "auto", "es", "en", ...
    language_option: Mapped[str] = mapped_column(String(16), nullable=False, default="auto")
    # Detected language once known.
    detected_language: Mapped[str | None] = mapped_column(String(16), nullable=True)

    # Resolved device/compute (never asserted before detection).
    device: Mapped[str | None] = mapped_column(String(16), nullable=True)
    compute_type: Mapped[str | None] = mapped_column(String(32), nullable=True)
    # Clear notice for the user, e.g. Apple Silicon runs on CPU.
    notice: Mapped[str | None] = mapped_column(Text, nullable=True)

    progress: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    processed_seconds: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    total_seconds: Mapped[float | None] = mapped_column(Float, nullable=True)

    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=_utc_now
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=_utc_now, onupdate=_utc_now
    )
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
