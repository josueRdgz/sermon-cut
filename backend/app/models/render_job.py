"""ORM model for local reel render jobs (FFmpeg)."""

from __future__ import annotations

import enum
import uuid
from datetime import UTC, datetime

from sqlalchemy import BigInteger, DateTime, Enum, Float, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.types import Uuid

from app.db.base import Base


def _utc_now() -> datetime:
    return datetime.now(UTC)


class RenderJobStatus(enum.StrEnum):
    """Lifecycle of a render job."""

    queued = "queued"
    running = "running"
    cancelling = "cancelling"
    cancelled = "cancelled"
    completed = "completed"
    failed = "failed"


ACTIVE_RENDER_STATUSES: frozenset[RenderJobStatus] = frozenset(
    {
        RenderJobStatus.queued,
        RenderJobStatus.running,
        RenderJobStatus.cancelling,
    }
)


class RenderJob(Base):
    """Persisted state of one FFmpeg render of a Reel.

    Progress comes from FFmpeg's ``-progress pipe:1`` stream and is stored in
    SQLite so the frontend can poll it. No Celery/Redis.
    """

    __tablename__ = "render_jobs"

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

    status: Mapped[RenderJobStatus] = mapped_column(
        Enum(RenderJobStatus, name="render_job_status", native_enum=False, length=32),
        nullable=False,
        default=RenderJobStatus.queued,
        index=True,
    )
    stage: Mapped[str | None] = mapped_column(String(64), nullable=True)

    aspect_ratio: Mapped[str] = mapped_column(String(16), nullable=False)
    layout: Mapped[str] = mapped_column(String(32), nullable=False)
    width: Mapped[int | None] = mapped_column(Integer, nullable=True)
    height: Mapped[int | None] = mapped_column(Integer, nullable=True)
    fps: Mapped[float | None] = mapped_column(Float, nullable=True)

    progress: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    processed_seconds: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    total_seconds: Mapped[float | None] = mapped_column(Float, nullable=True)
    speed: Mapped[float | None] = mapped_column(Float, nullable=True)

    # Relative to the project's renders/ directory; never an absolute path.
    output_filename: Mapped[str | None] = mapped_column(String(255), nullable=True)
    output_size_bytes: Mapped[int | None] = mapped_column(BigInteger, nullable=True)

    # Sanitized (shell-quoted) FFmpeg command, kept for debugging.
    ffmpeg_command: Mapped[str | None] = mapped_column(Text, nullable=True)
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=_utc_now
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=_utc_now, onupdate=_utc_now
    )
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
