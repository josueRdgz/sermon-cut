"""Keep source speech intact and realign A/V when *our* FFmpeg steps drift.

Editorial cuts (reel segments) still jump in time. This module only repairs
damage introduced by copy-cuts, muxing, or timestamp resets — it does not
stretch, squeeze, or rewrite healthy audio.
"""

from __future__ import annotations

import json
import shutil
import subprocess
from dataclasses import dataclass
from pathlib import Path

from app.core.exceptions import AppError
from app.services.render.binary import locate_ffmpeg
from app.services.render.runner import FFmpegError, run_ffmpeg

_START_DRIFT_SECONDS = 0.02
_DURATION_DRIFT_SECONDS = 0.04


@dataclass(frozen=True)
class AvAlignment:
    """Video vs audio clocks in one container."""

    video_start: float
    audio_start: float
    video_duration: float
    audio_duration: float

    @property
    def start_drift(self) -> float:
        return abs(self.video_start - self.audio_start)

    @property
    def duration_drift(self) -> float:
        return abs(self.video_duration - self.audio_duration)

    def needs_heal(self) -> bool:
        return (
            self.start_drift > _START_DRIFT_SECONDS
            or self.duration_drift > _DURATION_DRIFT_SECONDS
        )


def _ffprobe() -> str:
    executable = shutil.which("ffprobe")
    if executable is None:
        raise AppError(
            "FFprobe is not available on this system.",
            code="ffprobe_missing",
            status_code=503,
        )
    return executable


def _stream_clock(stream: dict) -> tuple[float, float] | None:
    try:
        start = float(stream.get("start_time") or 0.0)
    except (TypeError, ValueError):
        start = 0.0
    raw = stream.get("duration")
    if raw is None:
        return None
    try:
        duration = float(raw)
    except (TypeError, ValueError):
        return None
    if duration <= 0:
        return None
    return start, duration


def probe_av_alignment(path: Path) -> AvAlignment | None:
    """Return video/audio start and duration, or None if either stream is missing."""
    try:
        result = subprocess.run(
            [
                _ffprobe(),
                "-v",
                "quiet",
                "-print_format",
                "json",
                "-show_streams",
                str(path),
            ],
            capture_output=True,
            text=True,
            timeout=60,
            check=False,
        )
    except (OSError, subprocess.SubprocessError, AppError):
        return None
    if result.returncode != 0:
        return None
    try:
        payload = json.loads(result.stdout)
    except json.JSONDecodeError:
        return None
    streams = payload.get("streams") or []
    video = next((item for item in streams if item.get("codec_type") == "video"), None)
    audio = next((item for item in streams if item.get("codec_type") == "audio"), None)
    if video is None or audio is None:
        return None
    video_clock = _stream_clock(video)
    audio_clock = _stream_clock(audio)
    if video_clock is None or audio_clock is None:
        return None
    return AvAlignment(
        video_start=video_clock[0],
        audio_start=audio_clock[0],
        video_duration=video_clock[1],
        audio_duration=audio_clock[1],
    )


def heal_program_audio(path: Path) -> bool:
    """If FFmpeg left A/V drifted, remux with padded/trimmed audio (no stretch).

    Returns True when the file was rewritten.
    """
    alignment = probe_av_alignment(path)
    if alignment is None or not alignment.needs_heal():
        return False
    ffmpeg = locate_ffmpeg() or shutil.which("ffmpeg")
    if ffmpeg is None:
        return False

    duration = alignment.video_duration
    temp = path.with_name(f".{path.stem}.heal{path.suffix}")
    log_path = path.with_name(f"{path.stem}.heal.log")
    temp.unlink(missing_ok=True)
    try:
        result = run_ffmpeg(
            [
                ffmpeg,
                "-y",
                "-hide_banner",
                "-loglevel",
                "error",
                "-i",
                str(path),
                "-map",
                "0:v:0",
                "-map",
                "0:a:0",
                "-c:v",
                "copy",
                "-c:a",
                "aac",
                "-b:a",
                "192k",
                "-af",
                f"asetpts=PTS-STARTPTS,apad,atrim=0:{duration:.3f},asetpts=PTS-STARTPTS",
                "-movflags",
                "+faststart",
                "-avoid_negative_ts",
                "make_zero",
                str(temp),
            ],
            log_path=log_path,
        )
        if result.returncode != 0 or not temp.is_file() or temp.stat().st_size < 1024:
            temp.unlink(missing_ok=True)
            return False
        healed = probe_av_alignment(temp)
        if healed is not None and healed.needs_heal():
            temp.unlink(missing_ok=True)
            return False
        temp.replace(path)
        return True
    except (FFmpegError, OSError):
        temp.unlink(missing_ok=True)
        return False
