"""Pydantic schemas for export profiles."""

from __future__ import annotations

from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

from app.models.export_profile import ExportPlatform, ExportQuality, FpsMode


class ExportProfileUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    description: str | None = None
    width: int | None = Field(default=None, ge=360, le=2160)
    height: int | None = Field(default=None, ge=360, le=3840)
    aspect_ratio: str | None = Field(default=None, pattern=r"^\d+:\d+$")
    max_duration_seconds: int | None = Field(default=None, ge=5, le=180)
    fps_mode: FpsMode | None = None
    safe_margin_x: float | None = Field(default=None, ge=0.0, le=0.35)
    safe_top: float | None = Field(default=None, ge=0.0, le=0.4)
    safe_bottom: float | None = Field(default=None, ge=0.0, le=0.4)
    crf_draft: int | None = Field(default=None, ge=14, le=32)
    crf_standard: int | None = Field(default=None, ge=14, le=32)
    crf_high: int | None = Field(default=None, ge=14, le=32)
    preset_draft: str | None = Field(default=None, max_length=32)
    preset_standard: str | None = Field(default=None, max_length=32)
    preset_high: str | None = Field(default=None, max_length=32)
    audio_bitrate_draft_k: int | None = Field(default=None, ge=64, le=320)
    audio_bitrate_standard_k: int | None = Field(default=None, ge=64, le=320)
    audio_bitrate_high_k: int | None = Field(default=None, ge=64, le=320)
    fragmentation_enabled: bool | None = None
    fragment_max_seconds: int | None = Field(default=None, ge=5, le=180)
    prefer_small_file: bool | None = None
    is_active: bool | None = None


class ExportProfileResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    slug: str
    name: str
    description: str | None
    platform: ExportPlatform
    width: int
    height: int
    aspect_ratio: str
    video_codec: str
    audio_codec: str
    max_duration_seconds: int
    fps_mode: FpsMode
    safe_margin_x: float
    safe_top: float
    safe_bottom: float
    crf_draft: int
    crf_standard: int
    crf_high: int
    preset_draft: str
    preset_standard: str
    preset_high: str
    audio_bitrate_draft_k: int
    audio_bitrate_standard_k: int
    audio_bitrate_high_k: int
    fragmentation_enabled: bool
    fragment_max_seconds: int | None
    prefer_small_file: bool
    is_builtin: bool
    is_active: bool
    created_at: datetime
    updated_at: datetime


class ExportProfileListResponse(BaseModel):
    items: list[ExportProfileResponse]
    total: int
    qualities: list[ExportQuality] = [
        ExportQuality.draft,
        ExportQuality.standard,
        ExportQuality.high,
    ]


class SizeEstimateRequest(BaseModel):
    profile_id: UUID
    quality: ExportQuality = ExportQuality.standard
    crf: int | None = Field(default=None, ge=14, le=32)


class SizeEstimateResponse(BaseModel):
    duration_seconds: float
    width: int
    height: int
    fps: float
    crf: int
    audio_bitrate_k: int
    estimated_bytes: int
    estimated_mb: float
    note: str
    fragmentation_note: str | None = None
