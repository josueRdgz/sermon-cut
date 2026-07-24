"""ORM model for local YouTube import jobs (yt-dlp download)."""

from __future__ import annotations

import enum
import uuid
from datetime import UTC, datetime

from sqlalchemy import BigInteger, DateTime, Enum, Float, ForeignKey, String, Text
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.types import Uuid

from app.db.base import Base


def _utc_now() -> datetime:
    return datetime.now(UTC)


class YouTubeImportJobStatus(enum.StrEnum):
    """Lifecycle of a local YouTube import job.

    Downloading video and audio are separate phases because yt-dlp fetches the
    best video-only and audio-only streams individually before merging.
    """

    queued = "queued"
    validating = "validating"
    fetching_metadata = "fetching_metadata"
    downloading_video = "downloading_video"
    downloading_audio = "downloading_audio"
    merging = "merging"
    probing = "probing"
    completed = "completed"
    cancelling = "cancelling"
    cancelled = "cancelled"
    failed = "failed"


# States in which a job is still occupying a worker / not final.
ACTIVE_YOUTUBE_IMPORT_STATUSES: frozenset[YouTubeImportJobStatus] = frozenset(
    {
        YouTubeImportJobStatus.queued,
        YouTubeImportJobStatus.validating,
        YouTubeImportJobStatus.fetching_metadata,
        YouTubeImportJobStatus.downloading_video,
        YouTubeImportJobStatus.downloading_audio,
        YouTubeImportJobStatus.merging,
        YouTubeImportJobStatus.probing,
        YouTubeImportJobStatus.cancelling,
    }
)

_ALL_STATUS_VALUES: tuple[str, ...] = tuple(s.value for s in YouTubeImportJobStatus)


class YouTubeImportJob(Base):
    """Persisted state of a YouTube import.

    Only the metadata needed to drive the UI and debugging is stored — never the
    full ``--dump-single-json`` payload, cookies, or absolute local paths.
    """

    __tablename__ = "youtube_import_jobs"

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    project_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("projects.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    status: Mapped[YouTubeImportJobStatus] = mapped_column(
        Enum(
            *_ALL_STATUS_VALUES,
            name="youtube_import_job_status",
            native_enum=False,
            length=32,
        ),
        nullable=False,
        default=YouTubeImportJobStatus.queued,
        index=True,
    )
    stage: Mapped[str | None] = mapped_column(String(64), nullable=True)

    # Canonical single-video watch URL (never the original playlist URL).
    source_url: Mapped[str] = mapped_column(String(500), nullable=False)
    video_id: Mapped[str] = mapped_column(String(32), nullable=False)
    # Requested quality: "720p" | "1080p" | "best".
    requested_quality: Mapped[str] = mapped_column(String(16), nullable=False, default="1080p")

    # Preview metadata (kept small; a human-readable subset of the JSON dump).
    title: Mapped[str | None] = mapped_column(String(500), nullable=True)
    channel: Mapped[str | None] = mapped_column(String(300), nullable=True)
    duration_seconds: Mapped[float | None] = mapped_column(Float, nullable=True)
    thumbnail_url: Mapped[str | None] = mapped_column(String(1000), nullable=True)
    resolution_label: Mapped[str | None] = mapped_column(String(32), nullable=True)
    upload_date: Mapped[str | None] = mapped_column(String(16), nullable=True)
    # Format string actually selected by yt-dlp / probed from the output.
    selected_format: Mapped[str | None] = mapped_column(String(200), nullable=True)

    # Progress snapshot (approximate when video/audio download separately).
    progress: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    downloaded_bytes: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    total_bytes: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    speed_bps: Mapped[float | None] = mapped_column(Float, nullable=True)
    eta_seconds: Mapped[float | None] = mapped_column(Float, nullable=True)

    # Stored video filename (relative, bare name under the project dir).
    output_filename: Mapped[str | None] = mapped_column(String(255), nullable=True)

    # Stable machine code (e.g. "video_private") plus a localized message.
    error_code: Mapped[str | None] = mapped_column(String(64), nullable=True)
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=_utc_now
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=_utc_now, onupdate=_utc_now
    )
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
