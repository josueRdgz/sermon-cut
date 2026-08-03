"""Pydantic schemas for the optional AI analysis API."""

from __future__ import annotations

from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


class AnalysisStartRequest(BaseModel):
    max_reels: int = Field(default=5, ge=1, le=20)
    min_duration_seconds: float = Field(default=20.0, ge=5.0, le=120.0)
    max_duration_seconds: float = Field(default=60.0, ge=10.0, le=180.0)
    additional_instructions: str | None = Field(default=None, max_length=2000)
    doctrinal_orientation: str | None = Field(
        default=None,
        max_length=500,
        description="Override the default reformed editorial orientation.",
    )


class AnalysisCandidateSegment(BaseModel):
    start: float
    end: float
    exact_text: str
    reason: str = ""
    match_ratio: float | None = None
    snapped: bool = False


class AnalysisCandidateResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    job_id: UUID
    project_id: UUID
    rank: int
    status: str
    title: str
    hook: str | None
    summary: str | None
    editorial_score: float
    confidence: float
    joined_script: str | None
    caption: str | None
    hashtags: list[str] = Field(default_factory=list)
    suggested_titles: dict[str, str] = Field(default_factory=dict)
    thumbnail_text: str | None = None
    keywords: list[str] = Field(default_factory=list)
    segments: list[AnalysisCandidateSegment] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)
    removed_context_warning: str | None
    accepted_reel_id: UUID | None
    created_at: datetime
    updated_at: datetime


class AnalysisCandidateListResponse(BaseModel):
    items: list[AnalysisCandidateResponse]
    total: int


class AnalysisJobResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    project_id: UUID
    status: str
    stage: str | None
    provider: str
    max_reels: int
    min_duration_seconds: float
    max_duration_seconds: float
    additional_instructions: str | None
    doctrinal_orientation: str | None
    progress: float
    chunk_count: int
    chunks_completed: int
    prompt_tokens: int | None
    completion_tokens: int | None
    total_tokens: int | None
    rejected_count: int
    notice: str | None
    error_message: str | None
    created_at: datetime
    updated_at: datetime
    started_at: datetime | None
    finished_at: datetime | None
    candidates: list[AnalysisCandidateResponse] = Field(default_factory=list)


class AnalysisProviderStatusResponse(BaseModel):
    requested: str
    active: str
    gemini_configured: bool
    gemini_sdk_installed: bool
    gemini_model: str
    optional: bool = True


class AnalysisAcceptResponse(BaseModel):
    candidate: AnalysisCandidateResponse
    reel_id: UUID
