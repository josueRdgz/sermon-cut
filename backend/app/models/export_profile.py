"""ORM model for editable export profiles (YouTube Shorts, Reels, WhatsApp…)."""

from __future__ import annotations

import enum
import uuid
from datetime import UTC, datetime

from sqlalchemy import Boolean, DateTime, Enum, Float, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.types import Uuid

from app.db.base import Base


def _utc_now() -> datetime:
    return datetime.now(UTC)


class ExportPlatform(enum.StrEnum):
    youtube_shorts = "youtube_shorts"
    facebook_reels = "facebook_reels"
    instagram_reels = "instagram_reels"
    whatsapp_status = "whatsapp_status"
    custom = "custom"


class ExportQuality(enum.StrEnum):
    draft = "draft"
    standard = "standard"
    high = "high"


class FpsMode(enum.StrEnum):
    """Match the source frame rate, or force a constant 30 fps."""

    original = "original"
    fixed_30 = "fixed_30"


class ExportProfile(Base):
    """Editable H.264/AAC export target. Built-ins are seeded; users may tweak them."""

    __tablename__ = "export_profiles"
    __table_args__ = (UniqueConstraint("slug", name="uq_export_profiles_slug"),)

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    slug: Mapped[str] = mapped_column(String(64), nullable=False)
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    platform: Mapped[ExportPlatform] = mapped_column(
        Enum(ExportPlatform, name="export_platform", native_enum=False, length=32),
        nullable=False,
        default=ExportPlatform.custom,
    )

    width: Mapped[int] = mapped_column(Integer, nullable=False, default=1080)
    height: Mapped[int] = mapped_column(Integer, nullable=False, default=1920)
    aspect_ratio: Mapped[str] = mapped_column(String(16), nullable=False, default="9:16")

    video_codec: Mapped[str] = mapped_column(String(32), nullable=False, default="libx264")
    audio_codec: Mapped[str] = mapped_column(String(32), nullable=False, default="aac")

    # Soft cap on main+end-card duration (YouTube Shorts: 60 or 180).
    max_duration_seconds: Mapped[int] = mapped_column(Integer, nullable=False, default=60)
    fps_mode: Mapped[FpsMode] = mapped_column(
        Enum(FpsMode, name="export_fps_mode", native_enum=False, length=16),
        nullable=False,
        default=FpsMode.original,
    )

    # Safe-area fractions (0–0.4) used for subtitle margins / UI guidance.
    safe_margin_x: Mapped[float] = mapped_column(Float, nullable=False, default=0.08)
    safe_top: Mapped[float] = mapped_column(Float, nullable=False, default=0.10)
    safe_bottom: Mapped[float] = mapped_column(Float, nullable=False, default=0.16)

    # Quality → CRF / encode preset / audio bitrate (kbps). Overridable per render.
    crf_draft: Mapped[int] = mapped_column(Integer, nullable=False, default=28)
    crf_standard: Mapped[int] = mapped_column(Integer, nullable=False, default=23)
    crf_high: Mapped[int] = mapped_column(Integer, nullable=False, default=18)
    preset_draft: Mapped[str] = mapped_column(String(32), nullable=False, default="veryfast")
    preset_standard: Mapped[str] = mapped_column(String(32), nullable=False, default="medium")
    preset_high: Mapped[str] = mapped_column(String(32), nullable=False, default="slow")
    audio_bitrate_draft_k: Mapped[int] = mapped_column(Integer, nullable=False, default=128)
    audio_bitrate_standard_k: Mapped[int] = mapped_column(Integer, nullable=False, default=160)
    audio_bitrate_high_k: Mapped[int] = mapped_column(Integer, nullable=False, default=192)

    # WhatsApp-style optional fragmentation hint (seconds per chunk).
    fragmentation_enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    fragment_max_seconds: Mapped[int | None] = mapped_column(Integer, nullable=True)

    # Prefer smaller files (raises CRF slightly in estimates / WhatsApp defaults).
    prefer_small_file: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)

    is_builtin: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=_utc_now
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=_utc_now, onupdate=_utc_now
    )
