"""Schemas for reel timeline overlays."""

from __future__ import annotations

from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

from app.models.asset import ReelOverlayKind


class ReelOverlayCreate(BaseModel):
    kind: ReelOverlayKind = ReelOverlayKind.image
    asset_id: UUID | None = None
    text: str | None = Field(default=None, max_length=2000)
    style_json: str | None = None
    start_ms: int = Field(default=0, ge=0)
    duration_ms: int = Field(default=3000, ge=200, le=120_000)
    x: float | None = Field(default=None, ge=0.0, le=1.0)
    y: float | None = Field(default=None, ge=0.0, le=1.0)
    scale: float | None = Field(default=None, ge=0.05, le=2.0)
    opacity: float | None = Field(default=None, ge=0.05, le=1.0)
    z_index: int | None = Field(default=None, ge=0, le=100)
    order: int | None = Field(default=None, ge=0)


class ReelOverlayUpdate(BaseModel):
    asset_id: UUID | None = None
    text: str | None = Field(default=None, max_length=2000)
    style_json: str | None = None
    start_ms: int | None = Field(default=None, ge=0)
    duration_ms: int | None = Field(default=None, ge=200, le=120_000)
    x: float | None = Field(default=None, ge=0.0, le=1.0)
    y: float | None = Field(default=None, ge=0.0, le=1.0)
    scale: float | None = Field(default=None, ge=0.05, le=2.0)
    opacity: float | None = Field(default=None, ge=0.05, le=1.0)
    z_index: int | None = Field(default=None, ge=0, le=100)
    order: int | None = Field(default=None, ge=0)


class ReelOverlayResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    reel_id: UUID
    kind: ReelOverlayKind
    asset_id: UUID | None
    text: str | None
    style_json: str | None
    start_ms: int
    duration_ms: int
    x: float
    y: float
    scale: float
    opacity: float
    z_index: int
    order: int
    created_at: datetime
    updated_at: datetime
    asset_media_url: str | None = None


class ReelOverlayListResponse(BaseModel):
    items: list[ReelOverlayResponse]
    total: int
