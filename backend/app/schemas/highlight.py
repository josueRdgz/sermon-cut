"""Strict API contracts for horizontal Video Highlights."""

from __future__ import annotations

from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, model_validator

from app.models.highlight import SubtitleDelivery

EditorialStyle = Literal[
    "balanced", "doctrinal", "emotional", "evangelistic", "educational", "brief"
]
NarrativeCategory = Literal[
    "hook", "theme", "biblical", "application", "illustration", "conclusion"
]


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class SermonRangeUpdate(StrictModel):
    start: float = Field(ge=0)
    end: float = Field(gt=0)

    @model_validator(mode="after")
    def validate_range(self) -> SermonRangeUpdate:
        if self.end <= self.start:
            raise ValueError("end must be greater than start")
        return self


class HighlightAnalyzeRequest(StrictModel):
    target_duration_seconds: int = Field(default=300, ge=60, le=900)
    editorial_style: EditorialStyle = "balanced"
    editorial_context: str | None = Field(default=None, max_length=2000)


class HighlightSegmentInput(StrictModel):
    id: UUID | None = None
    start: float = Field(ge=0)
    end: float = Field(gt=0)
    transcript: str = Field(min_length=1, max_length=12000)
    reason: str = Field(default="", max_length=1000)
    score: float = Field(default=0.5, ge=0, le=1)
    category: NarrativeCategory = "theme"
    transition_type: Literal["hard_cut", "short_crossfade", "dip_to_black"] = "hard_cut"
    transition_duration_ms: int = Field(default=0, ge=0, le=1500)

    @model_validator(mode="after")
    def validate_range(self) -> HighlightSegmentInput:
        if self.end <= self.start:
            raise ValueError("end must be greater than start")
        return self


class HighlightReviewUpdate(StrictModel):
    segments: list[HighlightSegmentInput] = Field(min_length=1, max_length=40)


class StrategicTitles(StrictModel):
    recommended: str = Field(min_length=1, max_length=300)
    direct: str = Field(min_length=1, max_length=300)
    emotional: str = Field(min_length=1, max_length=300)
    biblical: str = Field(min_length=1, max_length=300)
    search_focused: str = Field(min_length=1, max_length=300)


class ContentMetadataUpdate(StrictModel):
    chosen_title: str | None = Field(default=None, max_length=300)
    description: str | None = Field(default=None, max_length=3000)
    thumbnail_text: str | None = Field(default=None, max_length=120)
    hashtags: list[str] | None = Field(default=None, max_length=8)
    keywords: list[str] | None = Field(default=None, max_length=20)


class HighlightPreviewClip(StrictModel):
    start: float = Field(ge=0)
    end: float = Field(gt=0)

    @model_validator(mode="after")
    def validate_range(self) -> HighlightPreviewClip:
        if self.end <= self.start:
            raise ValueError("end must be greater than start")
        return self


class HighlightPreviewRequest(StrictModel):
    clips: list[HighlightPreviewClip] = Field(min_length=1, max_length=40)


class HighlightPreviewResponse(StrictModel):
    ready: bool = True
    identity: str


class HighlightExportRequest(StrictModel):
    subtitle_delivery: SubtitleDelivery = SubtitleDelivery.burned
    normalize_loudness: bool = True
    crf: int | None = Field(default=None, ge=14, le=32)
    quality: Literal["draft", "standard", "high"] = "standard"


class HighlightSegmentResponse(StrictModel):
    id: UUID
    order: int
    start: float
    end: float
    duration: float
    transcript: str
    reason: str
    score: float
    category: str
    transition_type: str
    transition_duration_ms: int


class ContentMetadataResponse(StrictModel):
    suggested_titles: StrategicTitles | None = None
    chosen_title: str | None = None
    description: str | None = None
    thumbnail_text: str | None = None
    hashtags: list[str] = Field(default_factory=list)
    keywords: list[str] = Field(default_factory=list)


class HighlightPlanResponse(StrictModel):
    id: UUID
    project_id: UUID
    reel_id: UUID | None
    sermon_start: float | None
    sermon_end: float | None
    sermon_confidence: float | None
    detection_method: str | None
    detection_notes: str | None
    requires_manual_range: bool
    target_duration_seconds: int
    editorial_style: str
    subtitle_delivery: str
    title_theme: str | None
    biblical_references: list[str] = Field(default_factory=list)
    segments: list[HighlightSegmentResponse] = Field(default_factory=list)
    estimated_duration_seconds: float
    metadata: ContentMetadataResponse | None = None
    regeneration_history: list[dict] = Field(default_factory=list)
    created_at: datetime
    updated_at: datetime


class HighlightAnalysisJobResponse(StrictModel):
    id: UUID
    project_id: UUID
    plan_id: UUID
    status: str
    stage: str | None
    provider: str
    target_duration_seconds: int
    editorial_style: str
    progress: float
    prompt_tokens: int | None
    completion_tokens: int | None
    total_tokens: int | None
    error_message: str | None
    created_at: datetime
    updated_at: datetime
    started_at: datetime | None
    finished_at: datetime | None
    plan: HighlightPlanResponse | None = None


class HighlightRenderResponse(StrictModel):
    render_job_id: UUID
    srt_url: str | None = None
