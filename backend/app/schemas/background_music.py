"""Schemas for optional local background music."""

from __future__ import annotations

from pydantic import BaseModel, Field

from app.models.background_music import (
    RIGHTS_WARNING,
    BackgroundMusicPreset,
    BackgroundMusicScope,
)


class BackgroundMusicUpdate(BaseModel):
    preset: BackgroundMusicPreset | None = None
    scope: BackgroundMusicScope | None = None
    volume: float | None = Field(default=None, ge=0.0, le=1.0)
    start_seconds: float | None = Field(default=None, ge=0.0, le=36000.0)
    end_seconds: float | None = Field(default=None, ge=0.0, le=36000.0)
    fade_in_ms: int | None = Field(default=None, ge=0, le=15000)
    fade_out_ms: int | None = Field(default=None, ge=0, le=15000)
    ducking_enabled: bool | None = None
    target_lufs: float | None = Field(default=None, ge=-24.0, le=-12.0)
    true_peak_db: float | None = Field(default=None, ge=-3.0, le=-0.5)
    clear_music: bool = False


class BackgroundMusicResponse(BaseModel):
    preset: BackgroundMusicPreset
    scope: BackgroundMusicScope
    music_filename: str | None
    volume: float
    start_seconds: float
    end_seconds: float | None
    fade_in_ms: int
    fade_out_ms: int
    ducking_enabled: bool
    target_lufs: float
    true_peak_db: float
    enabled: bool
    rights_warning: str = RIGHTS_WARNING


class BackgroundMusicPresetInfo(BaseModel):
    id: BackgroundMusicPreset
    label: str
    description: str


class BackgroundMusicPresetListResponse(BaseModel):
    items: list[BackgroundMusicPresetInfo]
    default: BackgroundMusicPreset = BackgroundMusicPreset.none
    rights_warning: str = RIGHTS_WARNING


class BackgroundMusicMetersResponse(BaseModel):
    """Pre-export loudness / mix guidance (spoken-word oriented)."""

    enabled: bool
    preset: BackgroundMusicPreset
    target_lufs: float
    true_peak_db: float
    music_volume: float
    music_volume_db: float
    ducking_enabled: bool
    estimated_music_under_voice_db: float
    voice_priority_note: str
    normalize_note: str
    rights_warning: str = RIGHTS_WARNING
    clipping_risk: str
