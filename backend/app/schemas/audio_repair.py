"""API contracts for local audio repair."""

from __future__ import annotations

from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, Field


class AudioRepairStartRequest(BaseModel):
    """Tunable conservative detector thresholds."""

    silence_threshold: int = Field(default=8, ge=0, le=128)
    min_dropout_ms: float = Field(default=2.0, ge=0.5, le=20)
    max_auto_repair_ms: float = Field(default=60.0, ge=5, le=100)
    max_review_ms: float = Field(default=250.0, ge=100, le=1000)


class AudioRepairIssueResponse(BaseModel):
    start_seconds: float
    end_seconds: float
    duration_ms: float
    confidence: float
    repairable: bool
    repaired: bool
    kind: str


class AudioRepairJobResponse(BaseModel):
    id: UUID
    project_id: UUID
    status: str
    stage: str | None
    progress: float
    silence_threshold: int
    min_dropout_ms: float
    max_auto_repair_ms: float
    max_review_ms: float
    issue_count: int
    repaired_count: int
    review_count: int
    issues: list[AudioRepairIssueResponse]
    has_repaired_audio: bool
    has_repaired_video: bool
    error_message: str | None
    created_at: datetime
    updated_at: datetime
    started_at: datetime | None
    finished_at: datetime | None
