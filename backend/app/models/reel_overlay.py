"""Mid-timeline image and title overlays on the reel output clock."""

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


class ReelOverlayKind(enum.StrEnum):
    image = "image"
    text = "text"


class ReelOverlay(Base):
    """Graphic or title card placed on the assembled output timeline."""

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
        default=ReelOverlayKind.image,
    )
    asset_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("project_assets.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    text: Mapped[str | None] = mapped_column(Text, nullable=True)
    style_json: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Output-clock placement (milliseconds).
    start_ms: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    duration_ms: Mapped[int] = mapped_column(Integer, nullable=False, default=3000)

    # Normalized layout (center 0–1, scale relative to canvas short side).
    x: Mapped[float] = mapped_column(Float, nullable=False, default=0.5)
    y: Mapped[float] = mapped_column(Float, nullable=False, default=0.5)
    scale: Mapped[float] = mapped_column(Float, nullable=False, default=0.45)
    opacity: Mapped[float] = mapped_column(Float, nullable=False, default=1.0)
    z_index: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    order: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=_utc_now
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=_utc_now, onupdate=_utc_now
    )

    reel: Mapped[object] = relationship("Reel", back_populates="overlays")
