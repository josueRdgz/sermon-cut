"""Pydantic schemas for local transcription jobs."""

from __future__ import annotations

import enum
from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


class WhisperModelName(enum.StrEnum):
    """faster-whisper model sizes exposed to the client."""

    tiny = "tiny"
    base = "base"
    small = "small"
    medium = "medium"
    large_v3 = "large-v3"


class TranscriptionLanguage(enum.StrEnum):
    """Language selection for a transcription."""

    auto = "auto"
    spanish = "es"
    english = "en"


class TranscriptionStartRequest(BaseModel):
    """Request body to start a transcription."""

    model_config = ConfigDict(protected_namespaces=())

    model_name: WhisperModelName = Field(
        default=WhisperModelName.small,
        description="faster-whisper model. 'small' balances speed/quality; "
        "'medium' for higher quality on stronger hardware.",
    )
    language: TranscriptionLanguage = Field(
        default=TranscriptionLanguage.auto,
        description="Automatic detection, Spanish or English.",
    )


class TranscriptionJobResponse(BaseModel):
    """Public view of a transcription job for polling."""

    model_config = ConfigDict(from_attributes=True, protected_namespaces=())

    id: UUID
    project_id: UUID
    status: str
    stage: str | None
    model_name: str
    language_option: str
    detected_language: str | None
    device: str | None
    compute_type: str | None
    notice: str | None
    progress: float
    processed_seconds: float
    total_seconds: float | None
    error_message: str | None
    created_at: datetime
    updated_at: datetime
    started_at: datetime | None
    finished_at: datetime | None
