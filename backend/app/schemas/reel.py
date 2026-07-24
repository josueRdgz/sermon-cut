"""Pydantic schemas for Reels and their non-consecutive segments."""

from __future__ import annotations

from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

from app.models.reel import AspectRatio, ReelStatus, SubtitleStyle, TransitionType


class ReelSegmentCreate(BaseModel):
    """Payload to append a source window to a Reel."""

    source_start_seconds: float
    source_end_seconds: float
    transcript_text: str | None = None
    transition_type: TransitionType = TransitionType.hard_cut
    transition_duration_ms: int = Field(default=0, ge=0, le=5000)
    # Optional explicit order; if omitted, appends at the end.
    order: int | None = Field(default=None, ge=0)


class ReelSegmentUpdate(BaseModel):
    """Partial update of a ReelSegment (timing, text, transition)."""

    source_start_seconds: float | None = None
    source_end_seconds: float | None = None
    transcript_text: str | None = None
    transition_type: TransitionType | None = None
    transition_duration_ms: int | None = Field(default=None, ge=0, le=5000)


class ReelSegmentReorderItem(BaseModel):
    """One entry in a full reorder payload."""

    id: UUID
    order: int = Field(ge=0)


class ReelSegmentReorderRequest(BaseModel):
    """Replace the order of every segment in a Reel."""

    items: list[ReelSegmentReorderItem] = Field(min_length=1)


class ReelCreate(BaseModel):
    """Create a Reel; optionally seed it with one or more segments."""

    title: str = Field(min_length=1, max_length=300)
    hook: str | None = Field(default=None, max_length=500)
    description: str | None = None
    editorial_score: float | None = Field(default=None, ge=0, le=10)
    subtitle_style: SubtitleStyle = SubtitleStyle.default
    aspect_ratio: AspectRatio = AspectRatio.nine_sixteen
    status: ReelStatus = ReelStatus.draft
    segments: list[ReelSegmentCreate] = Field(default_factory=list)


class ReelUpdate(BaseModel):
    """Partial update of Reel metadata (not segments)."""

    title: str | None = Field(default=None, min_length=1, max_length=300)
    hook: str | None = Field(default=None, max_length=500)
    description: str | None = None
    editorial_score: float | None = Field(default=None, ge=0, le=10)
    subtitle_style: SubtitleStyle | None = None
    aspect_ratio: AspectRatio | None = None
    status: ReelStatus | None = None


class ReelSegmentResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    reel_id: UUID
    order: int
    source_start_seconds: float
    source_end_seconds: float
    transcript_text: str | None
    transition_type: TransitionType
    transition_duration_ms: int
    duration_seconds: float


class ReelResponse(BaseModel):
    """Public Reel including ordered segments and computed durations."""

    model_config = ConfigDict(from_attributes=True)

    id: UUID
    project_id: UUID
    title: str
    hook: str | None
    description: str | None
    editorial_score: float | None
    subtitle_style: SubtitleStyle
    aspect_ratio: AspectRatio
    status: ReelStatus
    created_at: datetime
    updated_at: datetime
    segments: list[ReelSegmentResponse]
    # Sum of source windows only (no transitions).
    content_duration_seconds: float
    # Content + transition times between segments.
    total_duration_seconds: float


class ReelListResponse(BaseModel):
    items: list[ReelResponse]
    total: int


class ReelFromTranscriptRequest(BaseModel):
    """Create a Reel (or append to one) from transcript segment timings."""

    title: str = Field(default="Nuevo Reel", min_length=1, max_length=300)
    transcript_segment_ids: list[UUID] = Field(min_length=1)
    aspect_ratio: AspectRatio = AspectRatio.nine_sixteen
    # When set, append the selected transcript spans to this existing Reel.
    reel_id: UUID | None = None
    transition_type: TransitionType = TransitionType.hard_cut
    transition_duration_ms: int = Field(default=0, ge=0, le=5000)
