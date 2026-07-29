"""Pydantic schemas for AI clip analysis requests and responses."""

from __future__ import annotations

from pydantic import BaseModel, Field, field_validator


class AnalysisPreferences(BaseModel):
    """User preferences that steer the editorial selection."""

    max_reels: int = Field(default=5, ge=1, le=20)
    min_duration_seconds: float = Field(default=20.0, ge=5.0, le=120.0)
    max_duration_seconds: float = Field(default=60.0, ge=10.0, le=180.0)
    max_segments_per_reel: int = Field(default=3, ge=1, le=10)
    min_segment_seconds: float = Field(default=8.0, ge=1.0, le=60.0)
    additional_instructions: str | None = Field(default=None, max_length=2000)
    # Doctrinal / editorial orientation (e.g. "reformed", "christocentric").
    doctrinal_orientation: str = Field(
        default="cristiano reformado: centralidad de Cristo, gracia, fe, santidad",
        max_length=500,
    )

    @field_validator("max_duration_seconds")
    @classmethod
    def _max_ge_min(cls, value: float, info) -> float:  # type: ignore[no-untyped-def]
        minimum = info.data.get("min_duration_seconds")
        if minimum is not None and value < minimum:
            raise ValueError("max_duration_seconds must be >= min_duration_seconds")
        return value


class SermonMetadata(BaseModel):
    """Project-level metadata sent to the provider."""

    title: str
    preacher_name: str | None = None
    bible_reference: str | None = None
    church_name: str
    youtube_channel: str
    duration_seconds: float


class TranscriptWordInput(BaseModel):
    start: float
    end: float
    text: str


class TranscriptSegmentInput(BaseModel):
    """One timed transcript segment, with absolute source clock."""

    order: int
    start: float
    end: float
    text: str
    words: list[TranscriptWordInput] = Field(default_factory=list)


class AnalysisRequest(BaseModel):
    """Everything a provider needs to suggest Reels."""

    metadata: SermonMetadata
    segments: list[TranscriptSegmentInput]
    preferences: AnalysisPreferences
    # Absolute time window of this chunk (for multi-chunk analysis).
    chunk_start: float | None = None
    chunk_end: float | None = None
    chunk_index: int = 0
    chunk_count: int = 1


class SuggestedSegment(BaseModel):
    """One non-consecutive window inside a suggested Reel."""

    start: float
    end: float
    exact_text: str = Field(min_length=1)
    reason: str = Field(default="", max_length=1000)


class SuggestedClip(BaseModel):
    """A Reel candidate that may join several non-consecutive segments."""

    title: str = Field(min_length=1, max_length=300)
    hook: str = Field(default="", max_length=500)
    summary: str = Field(default="", max_length=2000)
    editorial_score: float = Field(default=5.0, ge=0.0, le=10.0)
    segments: list[SuggestedSegment] = Field(min_length=1)
    joined_script: str = Field(default="", max_length=8000)
    removed_context_warning: str | None = Field(default=None, max_length=2000)
    caption: str = Field(default="", max_length=2200)
    hashtags: list[str] = Field(default_factory=list, max_length=20)


class AnalysisResponse(BaseModel):
    """Validated JSON envelope returned by every AI provider."""

    clips: list[SuggestedClip] = Field(default_factory=list)


class ProviderUsage(BaseModel):
    """Token / cost metrics when the API exposes them."""

    prompt_tokens: int | None = None
    completion_tokens: int | None = None
    total_tokens: int | None = None
    model: str | None = None


class ProviderResult(BaseModel):
    """Raw provider output plus optional usage metrics."""

    response: AnalysisResponse
    usage: ProviderUsage | None = None
    raw_text: str | None = None
