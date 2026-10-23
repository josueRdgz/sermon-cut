"""Pydantic schemas for in-app runtime settings."""

from __future__ import annotations

from pydantic import BaseModel, Field

from app.schemas.health import ToolInfo


WHISPER_MODELS = ("tiny", "base", "small", "medium", "large-v3")
AI_PROVIDERS = ("auto", "gemini", "mock")


class AppSettingsUpdate(BaseModel):
    gemini_api_key: str | None = Field(default=None, max_length=200)
    gemini_model: str | None = Field(default=None, min_length=1, max_length=80)
    ai_provider: str | None = Field(default=None, max_length=16)
    whisper_model: str | None = Field(default=None, max_length=32)
    clear_gemini_api_key: bool = False


class AppSettingsResponse(BaseModel):
    whisper_model: str
    whisper_models: list[str]
    ai_provider: str
    ai_providers: list[str]
    gemini_model: str
    gemini_configured: bool
    gemini_api_key_masked: str | None
    ffmpeg: ToolInfo
    ffprobe: ToolInfo
    whisper: ToolInfo
    gemini: ToolInfo
