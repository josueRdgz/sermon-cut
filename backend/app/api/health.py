"""Health endpoint: backend status, media tools, optional features, storage."""

from __future__ import annotations

from fastapi import APIRouter

from app.core.config import get_settings
from app.schemas.health import HealthResponse, StorageInfo, ToolInfo
from app.services.ffmpeg import get_ffmpeg_status, get_ffprobe_status
from app.services.system_stats import gemini_status, storage_usage, whisper_status

router = APIRouter(tags=["health"])


@router.get("/health", response_model=HealthResponse)
def health() -> HealthResponse:
    """Return backend status, media tools, optional features and storage usage."""
    settings = get_settings()
    ffmpeg = get_ffmpeg_status()
    ffprobe = get_ffprobe_status()
    whisper = whisper_status()
    gemini = gemini_status(settings)
    usage = storage_usage()

    return HealthResponse(
        status="ok",
        app_name=settings.app_name,
        version=settings.app_version,
        ffmpeg=ToolInfo(available=ffmpeg.available, version=ffmpeg.version),
        ffprobe=ToolInfo(available=ffprobe.available, version=ffprobe.version),
        whisper=ToolInfo(available=whisper.available, version=whisper.version),
        gemini=ToolInfo(available=gemini.available, version=gemini.version),
        storage=StorageInfo(
            bytes_used=usage.bytes_used,
            project_count=usage.project_count,
        ),
    )
