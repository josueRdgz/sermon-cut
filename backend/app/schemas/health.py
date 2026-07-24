"""Pydantic schemas for the health endpoint."""

from __future__ import annotations

from pydantic import BaseModel


class ToolInfo(BaseModel):
    """Availability and version of an external CLI tool / optional feature."""

    available: bool
    version: str | None = None


class StorageInfo(BaseModel):
    """Local storage footprint under the projects tree."""

    bytes_used: int
    project_count: int


class HealthResponse(BaseModel):
    """Response payload for GET /api/health."""

    status: str
    app_name: str
    version: str
    ffmpeg: ToolInfo
    ffprobe: ToolInfo
    whisper: ToolInfo
    gemini: ToolInfo
    storage: StorageInfo
