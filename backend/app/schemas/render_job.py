"""Pydantic schemas for reel render jobs."""

from __future__ import annotations

import enum
from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

from app.models.export_profile import ExportQuality
from app.models.reel import AspectRatio


class RenderLayout(enum.StrEnum):
    """How the source frame is fitted onto the output canvas."""

    center_crop = "center_crop"
    blurred_background = "blurred_background"
    auto_track = "auto_track"
    manual = "manual"


class RenderStartRequest(BaseModel):
    """Options for a new render."""

    profile_id: UUID | None = None
    quality: ExportQuality = ExportQuality.standard
    # Defaults to the profile (or Reel) aspect ratio when omitted.
    aspect_ratio: AspectRatio | None = None
    layout: RenderLayout = RenderLayout.center_crop
    normalize_loudness: bool = True
    # When set, overrides the quality→CRF mapping from the profile.
    crf: int | None = Field(default=None, ge=14, le=32)
    # When False, skip ASS burning even if the reel has subtitles enabled.
    burn_subtitles: bool = True


class RenderJobResponse(BaseModel):
    """Public view of a render job for polling."""

    model_config = ConfigDict(from_attributes=True)

    id: UUID
    project_id: UUID
    reel_id: UUID
    status: str
    stage: str | None
    aspect_ratio: str
    layout: str
    width: int | None
    height: int | None
    fps: float | None
    progress: float
    processed_seconds: float
    total_seconds: float | None
    speed: float | None
    output_filename: str | None
    output_size_bytes: int | None
    profile_id: UUID | None = None
    profile_slug: str | None = None
    profile_name: str | None = None
    quality: str | None = None
    crf: int | None = None
    encode_preset: str | None = None
    audio_bitrate_k: int | None = None
    sha256: str | None = None
    report_filename: str | None = None
    verified: bool | None = None
    expected_audio: bool | None = None
    publish_status: str | None = None
    ffmpeg_command: str | None
    error_message: str | None
    created_at: datetime
    updated_at: datetime
    started_at: datetime | None
    finished_at: datetime | None


class RenderJobListResponse(BaseModel):
    items: list[RenderJobResponse]
    total: int


class RevealResponse(BaseModel):
    filename: str
    opened: bool = True
    platform: str
    method: str
