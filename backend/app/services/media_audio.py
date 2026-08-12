"""Serve a WebKit-playable audio track for in-app preview.

WKWebView often stays silent on HEVC ``<video>`` and cannot use the same MP4 as
an ``<audio>`` source. Preview therefore needs a dedicated AAC/WAV file.
"""

from __future__ import annotations

import shutil
import threading
from pathlib import Path
from uuid import UUID

from app.core.exceptions import AppError, NotFoundError
from app.services import storage
from app.services.render.binary import locate_ffmpeg
from app.services.render.runner import FFmpegError, run_ffmpeg

_PREVIEW_NAME = "preview-audio.m4a"
_READY_WAVES = ("repaired-audio.wav", "original-audio.wav")


def preview_audio_path(project_id: UUID, video_filename: str) -> Path:
    """Return a playable audio file, extracting it from the project video if needed."""
    project_dir = storage.ensure_project_dir(project_id)
    for name in _READY_WAVES:
        existing = project_dir / name
        if existing.is_file() and existing.stat().st_size > 1024:
            return existing

    if not video_filename:
        raise NotFoundError("Project has no video.", code="video_not_found")
    source = storage.resolve_inside_project(project_id, video_filename)
    if not source.is_file():
        raise NotFoundError("Video file is missing on disk.", code="video_not_found")

    cached = project_dir / _PREVIEW_NAME
    if (
        cached.is_file()
        and cached.stat().st_size > 1024
        and cached.stat().st_mtime >= source.stat().st_mtime
    ):
        return cached

    ffmpeg = locate_ffmpeg() or shutil.which("ffmpeg")
    if ffmpeg is None:
        raise AppError("FFmpeg is not available.", code="ffmpeg_missing", status_code=503)

    temp = cached.with_name(f".{cached.name}.tmp")
    log_path = project_dir / "preview-audio.log"
    try:
        try:
            _extract(ffmpeg, source, temp, log_path, copy=True)
        except (FFmpegError, AppError):
            _extract(ffmpeg, source, temp, log_path, copy=False)
        temp.replace(cached)
    except Exception:
        temp.unlink(missing_ok=True)
        raise
    return cached


def _extract(ffmpeg: str, source: Path, destination: Path, log_path: Path, *, copy: bool) -> None:
    audio_args = ["-c:a", "copy"] if copy else ["-c:a", "aac", "-b:a", "192k"]
    result = run_ffmpeg(
        [
            ffmpeg,
            "-y",
            "-i",
            str(source),
            "-vn",
            "-map",
            "0:a:0",
            *audio_args,
            "-movflags",
            "+faststart",
            str(destination),
        ],
        cancel_event=threading.Event(),
        log_path=log_path,
    )
    if result.cancelled:
        raise AppError("Audio preview extraction was cancelled.", code="audio_preview_cancelled")
    if not destination.is_file() or destination.stat().st_size < 1024:
        raise AppError("FFmpeg produced an empty preview audio file.", code="audio_preview_empty")
