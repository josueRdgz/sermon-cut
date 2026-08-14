"""ORM model for a local sermon / preaching project."""

from __future__ import annotations

import enum
import uuid
from datetime import UTC, datetime

from sqlalchemy import Boolean, DateTime, Enum, Float, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.types import Uuid

from app.db.base import Base


def _utc_now() -> datetime:
    return datetime.now(UTC)


class ProjectStatus(enum.StrEnum):
    """Lifecycle states of a preaching project."""

    created = "created"
    importing = "importing"
    ready = "ready"
    transcribing = "transcribing"
    analyzing = "analyzing"
    editing = "editing"
    rendering = "rendering"
    completed = "completed"
    failed = "failed"


class ProjectContentMode(enum.StrEnum):
    """Content products enabled for a project."""

    shorts = "shorts"
    highlights = "highlights"
    both = "both"


class ProjectSourceKind(enum.StrEnum):
    """Whether the imported file is the whole service or only the sermon."""

    full_service = "full_service"
    sermon_only = "sermon_only"


class Project(Base):
    """A local project: metadata, media paths, and probed video properties.

    Binary media is stored on disk under ``storage/projects/{id}/``. Only
    relative file names are persisted in SQLite.
    """

    __tablename__ = "projects"

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)

    title: Mapped[str] = mapped_column(String(300), nullable=False)
    preacher_name: Mapped[str | None] = mapped_column(String(200), nullable=True)
    bible_reference: Mapped[str | None] = mapped_column(String(200), nullable=True)
    church_name: Mapped[str] = mapped_column(String(200), nullable=False)
    youtube_channel: Mapped[str] = mapped_column(String(200), nullable=False)
    full_sermon_url: Mapped[str | None] = mapped_column(String(500), nullable=True)
    content_mode: Mapped[ProjectContentMode] = mapped_column(
        Enum(
            ProjectContentMode,
            name="project_content_mode",
            native_enum=False,
            length=24,
        ),
        nullable=False,
        default=ProjectContentMode.shorts,
    )
    source_kind: Mapped[ProjectSourceKind] = mapped_column(
        Enum(
            ProjectSourceKind,
            name="project_source_kind",
            native_enum=False,
            length=24,
        ),
        nullable=False,
        default=ProjectSourceKind.sermon_only,
    )
    sermon_start_seconds: Mapped[float | None] = mapped_column(Float, nullable=True)
    sermon_end_seconds: Mapped[float | None] = mapped_column(Float, nullable=True)
    sermon_range_confirmed: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)

    # Relative file names inside the project directory (never absolute paths).
    video_filename: Mapped[str | None] = mapped_column(String(255), nullable=True)
    cover_filename: Mapped[str | None] = mapped_column(String(255), nullable=True)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=_utc_now
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=_utc_now, onupdate=_utc_now
    )

    duration_seconds: Mapped[float | None] = mapped_column(Float, nullable=True)
    width: Mapped[int | None] = mapped_column(Integer, nullable=True)
    height: Mapped[int | None] = mapped_column(Integer, nullable=True)
    fps: Mapped[float | None] = mapped_column(Float, nullable=True)
    video_codec: Mapped[str | None] = mapped_column(String(64), nullable=True)
    audio_codec: Mapped[str | None] = mapped_column(String(64), nullable=True)

    status: Mapped[ProjectStatus] = mapped_column(
        Enum(ProjectStatus, name="project_status", native_enum=False, length=32),
        nullable=False,
        default=ProjectStatus.created,
    )
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
