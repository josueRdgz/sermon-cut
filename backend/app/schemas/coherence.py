"""Schemas for join-coherence validation of multi-segment Reels."""

from __future__ import annotations

from enum import StrEnum
from uuid import UUID

from pydantic import BaseModel, Field

from app.schemas.reel import ReelResponse


class CoherenceSeverity(StrEnum):
    valid = "valid"
    warning = "warning"
    blocked = "blocked"


class CoherenceIssue(BaseModel):
    """One finding about a join or segment edge."""

    severity: CoherenceSeverity
    code: str
    message: str
    segment_id: int = Field(
        description="1-based index of the affected Reel segment in playback order."
    )
    segment_uuid: UUID | None = None
    recommendation: str = ""
    dismissed: bool = False


class CoherenceValidateRequest(BaseModel):
    """Options for a validation run."""

    include_ai_review: bool = False
    include_media_probes: bool = True


class CoherenceDismissRequest(BaseModel):
    """Ignore a warning (blocked findings cannot be dismissed)."""

    code: str
    segment_id: int = Field(ge=1)


class CoherenceExpandContextRequest(BaseModel):
    """Widen a segment by pulling neighbouring transcript context."""

    segment_id: int = Field(ge=1)
    # Seconds of context to add before and/or after the window.
    before_seconds: float = Field(default=1.5, ge=0.0, le=15.0)
    after_seconds: float = Field(default=1.5, ge=0.0, le=15.0)


class CoherenceAutoFixRequest(BaseModel):
    """Options for the automatic, non-destructive correction pass."""

    include_media_probes: bool = True


class CoherenceReport(BaseModel):
    """Aggregate result shown before the final render."""

    severity: CoherenceSeverity
    issues: list[CoherenceIssue] = Field(default_factory=list)
    joined_script: str = ""
    ai_reviewed: bool = False
    media_probed: bool = False
    can_render: bool = True
    summary: str = ""


class CoherenceAutoFixResponse(BaseModel):
    """Updated Reel plus the validation result after applying corrections."""

    reel: ReelResponse
    report: CoherenceReport
    fixes: list[str] = Field(default_factory=list)
    remaining_issues: int = 0
