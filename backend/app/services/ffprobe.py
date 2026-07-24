"""Video metadata extraction via the system-installed FFprobe."""

from __future__ import annotations

import json
import shutil
import subprocess
from dataclasses import dataclass
from fractions import Fraction
from pathlib import Path

from app.core.exceptions import AppError


@dataclass(frozen=True)
class VideoMetadata:
    """Media properties obtained from FFprobe."""

    duration_seconds: float | None
    width: int | None
    height: int | None
    fps: float | None
    video_codec: str | None
    audio_codec: str | None


def _parse_fps(rate: str | None) -> float | None:
    if not rate or rate in {"0/0", "N/A"}:
        return None
    try:
        value = float(Fraction(rate))
    except (ValueError, ZeroDivisionError):
        return None
    return value if value > 0 else None


def probe_video(path: Path) -> VideoMetadata:
    """Run FFprobe on ``path`` and return duration, resolution, FPS and codecs."""
    executable = shutil.which("ffprobe")
    if executable is None:
        raise AppError(
            "FFprobe is not available on this system.",
            code="ffprobe_missing",
            status_code=503,
        )

    try:
        result = subprocess.run(
            [
                executable,
                "-v",
                "quiet",
                "-print_format",
                "json",
                "-show_format",
                "-show_streams",
                str(path),
            ],
            capture_output=True,
            text=True,
            timeout=60,
            check=False,
        )
    except (OSError, subprocess.SubprocessError) as exc:
        raise AppError(
            f"Failed to run FFprobe: {exc}",
            code="ffprobe_failed",
            status_code=500,
        ) from exc

    if result.returncode != 0:
        raise AppError(
            "FFprobe could not read the uploaded video.",
            code="ffprobe_failed",
            status_code=422,
        )

    try:
        payload = json.loads(result.stdout)
    except json.JSONDecodeError as exc:
        raise AppError(
            "FFprobe returned invalid JSON.",
            code="ffprobe_failed",
            status_code=500,
        ) from exc

    streams = payload.get("streams") or []
    video_stream = next((s for s in streams if s.get("codec_type") == "video"), None)
    audio_stream = next((s for s in streams if s.get("codec_type") == "audio"), None)
    format_info = payload.get("format") or {}

    duration: float | None = None
    raw_duration = format_info.get("duration")
    if raw_duration is not None:
        try:
            duration = float(raw_duration)
        except (TypeError, ValueError):
            duration = None
    if duration is None and video_stream and video_stream.get("duration") is not None:
        try:
            duration = float(video_stream["duration"])
        except (TypeError, ValueError):
            duration = None

    width = int(video_stream["width"]) if video_stream and video_stream.get("width") else None
    height = int(video_stream["height"]) if video_stream and video_stream.get("height") else None
    fps = _parse_fps(video_stream.get("avg_frame_rate") if video_stream else None)
    if fps is None and video_stream:
        fps = _parse_fps(video_stream.get("r_frame_rate"))

    return VideoMetadata(
        duration_seconds=duration,
        width=width,
        height=height,
        fps=fps,
        video_codec=video_stream.get("codec_name") if video_stream else None,
        audio_codec=audio_stream.get("codec_name") if audio_stream else None,
    )
