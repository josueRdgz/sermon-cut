"""Pydantic schemas for the mandatory end card."""

from __future__ import annotations

from pydantic import BaseModel, ConfigDict, Field

from app.models.end_card import (
    MAX_END_CARD_SECONDS,
    MIN_END_CARD_SECONDS,
    EndCardAudioMode,
    EndCardLayout,
)


class EndCardSettingsUpdate(BaseModel):
    """Partial update for the global or per-project end card configuration."""

    layout: EndCardLayout | None = None
    duration_seconds: float | None = Field(
        default=None, ge=MIN_END_CARD_SECONDS, le=MAX_END_CARD_SECONDS
    )
    fade_in_ms: int | None = Field(default=None, ge=0, le=3000)
    audio_fade_out_ms: int | None = Field(default=None, ge=0, le=5000)
    audio_mode: EndCardAudioMode | None = None
    music_volume: float | None = Field(default=None, ge=0.0, le=1.0)
    url_text: str | None = Field(default=None, max_length=500)
    show_qr: bool | None = None
    qr_url: str | None = Field(default=None, max_length=500)
    channel_handle: str | None = Field(default=None, max_length=200)
    custom_message: str | None = Field(default=None, max_length=500)


class EndCardSettingsResponse(BaseModel):
    """Effective end card configuration, with its provenance."""

    model_config = ConfigDict(from_attributes=True)

    layout: EndCardLayout
    duration_seconds: float
    fade_in_ms: int
    audio_fade_out_ms: int
    audio_mode: EndCardAudioMode
    music_filename: str | None
    music_volume: float
    logo_filename: str | None
    url_text: str | None
    show_qr: bool
    qr_url: str | None
    channel_handle: str | None
    custom_message: str | None
    # False when the project inherits the global configuration.
    is_project_override: bool
    # The end card cannot be disabled; surfaced so the UI can say so.
    is_mandatory: bool = True
    min_duration_seconds: float = MIN_END_CARD_SECONDS
    max_duration_seconds: float = MAX_END_CARD_SECONDS


class EndCardLayoutInfo(BaseModel):
    """A selectable design."""

    id: EndCardLayout
    label: str
    description: str
    needs_cover: bool


class EndCardLayoutListResponse(BaseModel):
    items: list[EndCardLayoutInfo]
