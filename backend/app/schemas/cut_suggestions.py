"""Schemas for optional technical cut suggestions."""

from __future__ import annotations

from enum import StrEnum
from uuid import UUID

from pydantic import BaseModel, Field

from app.schemas.reel import ReelResponse


class CutIntensity(StrEnum):
    conservative = "conservative"
    balanced = "balanced"
    aggressive = "aggressive"


class CutSuggestionKind(StrEnum):
    trim_leading_silence = "trim_leading_silence"
    trim_trailing_silence = "trim_trailing_silence"
    reduce_internal_silence = "reduce_internal_silence"
    long_pause = "long_pause"
    filler_word = "filler_word"
    immediate_repetition = "immediate_repetition"
    false_start = "false_start"


class CutSuggestionStatus(StrEnum):
    pending = "pending"
    accepted = "accepted"
    rejected = "rejected"


class CutSuggestRequest(BaseModel):
    """Options for generating suggestions (never auto-applies)."""

    intensity: CutIntensity = CutIntensity.conservative
    include_silence: bool = True
    include_fillers: bool = True


class CutSuggestion(BaseModel):
    """One optional technical cut the user may accept or reject."""

    id: UUID
    kind: CutSuggestionKind
    intensity: CutIntensity
    status: CutSuggestionStatus = CutSuggestionStatus.pending
    segment_id: int = Field(ge=1, description="1-based Reel segment index.")
    segment_uuid: UUID
    region_start: float
    region_end: float
    message: str
    recommendation: str
    matched_text: str | None = None
    confidence: float = Field(default=0.5, ge=0.0, le=1.0)
    requires_review: bool = False
    new_start: float | None = None
    new_end: float | None = None
    split: bool = False
    keep_before_end: float | None = None
    keep_after_start: float | None = None
    apply_crossfade_ms: int = Field(default=220, ge=0, le=5000)
    keep_margin: float = 0.0


class CutSuggestionsReport(BaseModel):
    intensity: CutIntensity
    suggestions: list[CutSuggestion] = Field(default_factory=list)
    pending_count: int = 0
    summary: str = ""
    auto_applied: bool = False


class CutSuggestionActionResponse(BaseModel):
    """Result of accepting or rejecting one suggestion."""

    suggestion: CutSuggestion
    report: CutSuggestionsReport
    reel_id: UUID
    reel: ReelResponse
    subtitles_stale: bool = True
    note: str = (
        "Los subtítulos se recalculan desde las ventanas actualizadas del Reel."
    )
