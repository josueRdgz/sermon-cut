"""ORM models for project media assets and reel overlays (B-roll / titles)."""

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


class ProjectAssetKind(enum.StrEnum):
    """Kind of file stored in the project media bin."""

    image = "image"
    video = "video"
    audio = "audio"
    other = "other"


class ReelOverlayKind(enum.StrEnum):
    """Visual layer composited over the assembled reel (not A-roll)."""

    image = "image"
    text = "text"
    video = "video"


class ProjectAsset(Base):
    """A user-uploaded file in the project bin (images, B-roll, etc.)."""

    __tablename__ = "project_assets"

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    project_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("projects.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    kind: Mapped[ProjectAssetKind] = mapped_column(
        Enum(ProjectAssetKind, name="project_asset_kind", native_enum=False, length=16),
        nullable=False,
    )
    filename: Mapped[str] = mapped_column(String(255), nullable=False)
    storage_path: Mapped[str] = mapped_column(String(512), nullable=False)
    original_name: Mapped[str | None] = mapped_column(String(300), nullable=True)
    width: Mapped[int | None] = mapped_column(Integer, nullable=True)
    height: Mapped[int | None] = mapped_column(Integer, nullable=True)
    duration_ms: Mapped[int | None] = mapped_column(Integer, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=_utc_now
    )

    overlays: Mapped[list[ReelOverlay]] = relationship(back_populates="asset")


class ReelOverlay(Base):
    """One image, title or B-roll clip placed on the output clock."""

    __tablename__ = "reel_overlays"

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    reel_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("reels.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    kind: Mapped[ReelOverlayKind] = mapped_column(
        Enum(ReelOverlayKind, name="reel_overlay_kind", native_enum=False, length=16),
        nullable=False,
    )
    asset_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("project_assets.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    text: Mapped[str | None] = mapped_column(Text, nullable=True)
    style_json: Mapped[str | None] = mapped_column(Text, nullable=True)
    start_ms: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    duration_ms: Mapped[int] = mapped_column(Integer, nullable=False, default=3000)
    x: Mapped[float] = mapped_column(Float, nullable=False, default=0.5)
    y: Mapped[float] = mapped_column(Float, nullable=False, default=0.35)
    scale: Mapped[float] = mapped_column(Float, nullable=False, default=0.4)
    opacity: Mapped[float] = mapped_column(Float, nullable=False, default=1.0)
    z_index: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    order: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=_utc_now
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=_utc_now, onupdate=_utc_now
    )

    asset: Mapped[ProjectAsset | None] = relationship(back_populates="overlays")
