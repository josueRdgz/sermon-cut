"""ORM model for optional user-provided background music (project-scoped)."""

from __future__ import annotations

import enum
import uuid
from datetime import UTC, datetime

from sqlalchemy import Boolean, DateTime, Enum, Float, ForeignKey, Integer, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.types import Uuid

from app.db.base import Base


def _utc_now() -> datetime:
    return datetime.now(UTC)


class BackgroundMusicPreset(enum.StrEnum):
    """Named presets. ``none`` is the safe default — music stays off."""

    none = "none"
    end_card_only = "end_card_only"
    very_soft_background = "very_soft_background"


class BackgroundMusicScope(enum.StrEnum):
    """Where the bed plays once a file is present and the preset is not ``none``."""

    full_reel = "full_reel"
    end_card_only = "end_card_only"


class BackgroundMusicSettings(Base):
    """Optional local music bed for one project.

    Music is never downloaded and never pulled from a commercial catalogue —
    the user must upload their own file and hold the rights to use it.
    """

    __tablename__ = "background_music_settings"
    __table_args__ = (
        UniqueConstraint("project_id", name="uq_background_music_settings_project_id"),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    project_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("projects.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    preset: Mapped[BackgroundMusicPreset] = mapped_column(
        Enum(
            BackgroundMusicPreset,
            name="background_music_preset",
            native_enum=False,
            length=32,
        ),
        nullable=False,
        default=BackgroundMusicPreset.none,
    )
    scope: Mapped[BackgroundMusicScope] = mapped_column(
        Enum(
            BackgroundMusicScope,
            name="background_music_scope",
            native_enum=False,
            length=32,
        ),
        nullable=False,
        default=BackgroundMusicScope.full_reel,
    )

    music_filename: Mapped[str | None] = mapped_column(String(255), nullable=True)

    volume: Mapped[float] = mapped_column(Float, nullable=False, default=0.10)
    start_seconds: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    # None / null end means “use as much of the file as the timeline needs”.
    end_seconds: Mapped[float | None] = mapped_column(Float, nullable=True)
    fade_in_ms: Mapped[int] = mapped_column(Integer, nullable=False, default=1200)
    fade_out_ms: Mapped[int] = mapped_column(Integer, nullable=False, default=1800)

    ducking_enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    # Integrated loudness target for the final mix (spoken-word friendly).
    target_lufs: Mapped[float] = mapped_column(Float, nullable=False, default=-16.0)
    true_peak_db: Mapped[float] = mapped_column(Float, nullable=False, default=-1.5)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=_utc_now
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=_utc_now, onupdate=_utc_now
    )


# Rights notice shown in the UI and API responses (never auto-download music).
RIGHTS_WARNING = (
    "El usuario es responsable de contar con los derechos necesarios para utilizar este audio."
)
