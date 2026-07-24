"""Pydantic schemas for the health endpoint."""

from __future__ import annotations

from pydantic import BaseModel


class ToolInfo(BaseModel):
    """Availability and version of an external CLI tool."""

    available: bool
    version: str | None = None


class HealthResponse(BaseModel):
    """Response payload for GET /api/health."""

    status: str
    app_name: str
    ffmpeg: ToolInfo
    ffprobe: ToolInfo
