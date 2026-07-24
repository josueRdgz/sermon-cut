"""Schemas for optional vertical subject tracking / reframing."""

from __future__ import annotations

from uuid import UUID

from pydantic import BaseModel, Field

from app.services.tracking.types import FramingMode


class TrackingComputeRequest(BaseModel):
    tracker: str = "opencv"  # opencv | mediapipe
    sample_fps: float = Field(default=2.0, ge=0.5, le=6.0)
    aspect_ratio: str | None = None


class TrackingSegmentResult(BaseModel):
    segment_id: int
    segment_uuid: UUID
    stability: float
    unstable: bool
    mode: FramingMode
    sample_count: int
    keyframe_count: int


class TrackingReport(BaseModel):
    reel_id: UUID
    tracker: str
    cached: bool
    segments: list[TrackingSegmentResult] = Field(default_factory=list)
    mediapipe: dict = Field(default_factory=dict)
    summary: str = ""


class FramingModeUpdate(BaseModel):
    framing_mode: FramingMode


class ManualCropUpdate(BaseModel):
    """Normalized subject center (0–1) for a manual crop box."""

    x: float = Field(ge=0.0, le=1.0)
    y: float = Field(ge=0.0, le=1.0)
    zoom: float = Field(default=1.0, ge=0.8, le=2.0)


class FramingStatusResponse(BaseModel):
    reel_id: UUID
    framing_mode: FramingMode
    has_cache: bool
    cache_segments: int = 0
    mediapipe: dict = Field(default_factory=dict)
    cleared: bool = False


class FramingPreviewResponse(BaseModel):
    segment_uuid: UUID
    source_time: float
    mode: FramingMode
    crop_x: float
    crop_y: float
    canvas_width: int
    canvas_height: int
    norm_x: float
    norm_y: float
    norm_w: float
    norm_h: float
    preview_filename: str | None = None
    unstable: bool = False
