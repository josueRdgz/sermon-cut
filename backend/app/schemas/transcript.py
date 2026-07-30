"""Pydantic schemas for transcripts."""

from __future__ import annotations

import math
from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.models.transcript import TranscriptSource, TranscriptStatus


class TranscriptWordResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    order: int
    start_seconds: float | None
    end_seconds: float | None
    text: str
    confidence: float | None


class TranscriptSegmentResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    order: int
    start_seconds: float | None
    end_seconds: float | None
    text: str
    words: list[TranscriptWordResponse] = Field(default_factory=list)


class TranscriptResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    project_id: UUID
    source: TranscriptSource
    language: str | None
    status: TranscriptStatus
    full_text: str
    has_word_timestamps: bool
    created_at: datetime
    updated_at: datetime
    segments: list[TranscriptSegmentResponse] = Field(default_factory=list)


class TranscriptSegmentUpdate(BaseModel):
    """Partial edit of a segment's text and/or timing."""

    text: str | None = Field(default=None, min_length=1)
    start_seconds: float | None = Field(default=None, ge=0)
    end_seconds: float | None = Field(default=None, ge=0)

    @field_validator("start_seconds", "end_seconds")
    @classmethod
    def reject_non_finite(cls, value: float | None) -> float | None:
        if value is not None and not math.isfinite(value):
            raise ValueError("El tiempo debe ser un número finito (no NaN ni Infinity).")
        return value


class ExportWord(BaseModel):
    start: float | None = None
    end: float | None = None
    text: str
    confidence: float | None = None


class ExportSegment(BaseModel):
    start: float | None = None
    end: float | None = None
    text: str
    words: list[ExportWord] = Field(default_factory=list)


class ExportTranscript(BaseModel):
    """Canonical JSON export shape (format-independent)."""

    language: str | None = None
    segments: list[ExportSegment]
