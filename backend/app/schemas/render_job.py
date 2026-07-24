"""Pydantic schemas for reel render jobs."""

from __future__ import annotations

import enum
from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

from app.models.reel import AspectRatio


class RenderLayout(enum.StrEnum):
    """How the source frame is fitted onto the output canvas."""

    center_crop = "center_crop"
    blurred_background = "blurred_background"


class RenderStartRequest(BaseModel):
    """Options for a new render."""

    # Defaults to the Reel's own aspect ratio when omitted.
    aspect_ratio: AspectRatio | None = None
    layout: RenderLayout = RenderLayout.center_crop
    normalize_loudness: bool = True
    crf: int = Field(default=20, ge=14, le=32)
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
    ffmpeg_command: str | None
    error_message: str | None
    created_at: datetime
    updated_at: datetime
    started_at: datetime | None
    finished_at: datetime | None


class RenderJobListResponse(BaseModel):
    items: list[RenderJobResponse]
    total: int
