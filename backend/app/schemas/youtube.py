"""Pydantic schemas for the optional YouTube import feature."""

from __future__ import annotations

import enum
from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


class YouTubeQuality(enum.StrEnum):
    """User-selectable download quality (never 4K by default)."""

    q720 = "720p"
    q1080 = "1080p"
    best = "best"


class YouTubePreviewRequest(BaseModel):
    """Request body to validate a URL and fetch a preview."""

    url: str = Field(..., min_length=1, max_length=2000)


class YouTubePreviewResponse(BaseModel):
    """Compact, non-sensitive preview of a YouTube video."""

    video_id: str
    title: str | None
    channel: str | None
    duration_seconds: float | None
    thumbnail_url: str | None
    resolution_label: str | None
    upload_date: str | None


class YouTubeImportRequest(BaseModel):
    """Request body to start importing a video into a project."""

    url: str = Field(..., min_length=1, max_length=2000)
    quality: YouTubeQuality = Field(default=YouTubeQuality.q1080)


class YouTubeImportJobResponse(BaseModel):
    """Public view of an import job for polling.

    Never includes cookies, raw command lines, or absolute local paths.
    """

    model_config = ConfigDict(from_attributes=True)

    id: UUID
    project_id: UUID
    status: str
    stage: str | None
    video_id: str
    requested_quality: str
    title: str | None
    channel: str | None
    duration_seconds: float | None
    thumbnail_url: str | None
    resolution_label: str | None
    upload_date: str | None
    selected_format: str | None
    progress: float
    downloaded_bytes: int | None
    total_bytes: int | None
    speed_bps: float | None
    eta_seconds: float | None
    output_filename: str | None
    error_code: str | None
    error_message: str | None
    created_at: datetime
    updated_at: datetime
    started_at: datetime | None
    finished_at: datetime | None
