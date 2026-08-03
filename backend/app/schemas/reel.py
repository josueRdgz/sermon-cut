"""Pydantic schemas for Reels and their non-consecutive segments."""

from __future__ import annotations

from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

from app.models.reel import (
    AspectRatio,
    ContentKind,
    ReelStatus,
    SubtitleGranularity,
    SubtitlePosition,
    SubtitleStyle,
    TransitionType,
)


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
    manual_crop_x: float | None = Field(default=None, ge=0.0, le=1.0)
    manual_crop_y: float | None = Field(default=None, ge=0.0, le=1.0)
    manual_crop_zoom: float | None = Field(default=None, ge=0.8, le=2.0)


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
    content_kind: ContentKind = ContentKind.short
    subtitle_style: SubtitleStyle = SubtitleStyle.reformed_sober
    subtitle_enabled: bool = True
    subtitle_granularity: SubtitleGranularity = SubtitleGranularity.auto
    subtitle_font_size: int = Field(default=52, ge=24, le=96)
    subtitle_position: SubtitlePosition = SubtitlePosition.bottom
    subtitle_uppercase: bool = False
    subtitle_max_words: int = Field(default=6, ge=1, le=24)
    subtitle_opacity: float = Field(default=1.0, ge=0.2, le=1.0)
    subtitle_margin_bottom: int = Field(default=120, ge=40, le=400)
    subtitle_bible_reference: str | None = Field(default=None, max_length=200)
    aspect_ratio: AspectRatio = AspectRatio.nine_sixteen
    status: ReelStatus = ReelStatus.draft
    audio_offset_ms: int = Field(default=0, ge=-1000, le=1000)
    segments: list[ReelSegmentCreate] = Field(default_factory=list)


class ReelUpdate(BaseModel):
    """Partial update of Reel metadata (not segments)."""

    title: str | None = Field(default=None, min_length=1, max_length=300)
    hook: str | None = Field(default=None, max_length=500)
    description: str | None = None
    editorial_score: float | None = Field(default=None, ge=0, le=10)
    subtitle_style: SubtitleStyle | None = None
    subtitle_enabled: bool | None = None
    subtitle_granularity: SubtitleGranularity | None = None
    subtitle_font_size: int | None = Field(default=None, ge=24, le=96)
    subtitle_position: SubtitlePosition | None = None
    subtitle_uppercase: bool | None = None
    subtitle_max_words: int | None = Field(default=None, ge=1, le=24)
    subtitle_opacity: float | None = Field(default=None, ge=0.2, le=1.0)
    subtitle_margin_bottom: int | None = Field(default=None, ge=40, le=400)
    subtitle_bible_reference: str | None = Field(default=None, max_length=200)
    aspect_ratio: AspectRatio | None = None
    status: ReelStatus | None = None
    framing_mode: str | None = None
    audio_offset_ms: int | None = Field(default=None, ge=-1000, le=1000)


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
    manual_crop_x: float | None = None
    manual_crop_y: float | None = None
    manual_crop_zoom: float | None = None
    selection_reason: str | None = None
    selection_score: float | None = None
    narrative_category: str | None = None


class ReelResponse(BaseModel):
    """Public Reel including ordered segments and computed durations."""

    model_config = ConfigDict(from_attributes=True)

    id: UUID
    project_id: UUID
    title: str
    hook: str | None
    description: str | None
    editorial_score: float | None
    content_kind: ContentKind
    subtitle_style: SubtitleStyle
    subtitle_enabled: bool
    subtitle_granularity: SubtitleGranularity
    subtitle_font_size: int
    subtitle_position: SubtitlePosition
    subtitle_uppercase: bool
    subtitle_max_words: int
    subtitle_opacity: float
    subtitle_margin_bottom: int
    subtitle_bible_reference: str | None
    aspect_ratio: AspectRatio
    status: ReelStatus
    framing_mode: str = "center_crop"
    audio_offset_ms: int = 0
    created_at: datetime
    updated_at: datetime
    segments: list[ReelSegmentResponse]
    # Sum of source windows only (no transitions).
    content_duration_seconds: float
    # Assembled output duration (matches FFmpeg / subtitle timeline).
    total_duration_seconds: float
    # Ignored coherence warnings (code + segment), persisted on the Reel.
    coherence_dismissals: list[dict] = Field(default_factory=list)


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
