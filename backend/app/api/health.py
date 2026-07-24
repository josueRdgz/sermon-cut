"""Health endpoint: reports backend status and FFmpeg/FFprobe availability."""

from __future__ import annotations

from fastapi import APIRouter

from app.core.config import get_settings
from app.schemas.health import HealthResponse, ToolInfo
from app.services.ffmpeg import get_ffmpeg_status, get_ffprobe_status

router = APIRouter(tags=["health"])


@router.get("/health", response_model=HealthResponse)
def health() -> HealthResponse:
    """Return backend status and the versions of the required media tools."""
    settings = get_settings()
    ffmpeg = get_ffmpeg_status()
    ffprobe = get_ffprobe_status()

    return HealthResponse(
        status="ok",
        app_name=settings.app_name,
        ffmpeg=ToolInfo(available=ffmpeg.available, version=ffmpeg.version),
        ffprobe=ToolInfo(available=ffprobe.available, version=ffprobe.version),
    )
