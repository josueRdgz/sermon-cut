"""Pydantic schemas for transcripts."""

from __future__ import annotations

from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

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
