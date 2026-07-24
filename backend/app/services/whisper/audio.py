"""Extract audio from a video into WAV mono 16 kHz using FFmpeg."""

from __future__ import annotations

import shutil
import subprocess
from pathlib import Path

from app.core.exceptions import AppError

# faster-whisper expects 16 kHz mono PCM.
TARGET_SAMPLE_RATE = 16000
TARGET_CHANNELS = 1


def build_ffmpeg_command(video_path: Path, audio_path: Path, ffmpeg: str = "ffmpeg") -> list[str]:
    """Build the FFmpeg command that produces WAV mono 16 kHz."""
    return [
        ffmpeg,
        "-y",
        "-i",
        str(video_path),
        "-vn",
        "-ac",
        str(TARGET_CHANNELS),
        "-ar",
        str(TARGET_SAMPLE_RATE),
        "-c:a",
        "pcm_s16le",
        "-f",
        "wav",
        str(audio_path),
    ]


def extract_audio(video_path: Path, audio_path: Path) -> Path:
    """Extract ``video_path`` audio to ``audio_path`` (WAV mono 16 kHz).

    Returns the audio path. Raises ``AppError`` on failure.
    """
    ffmpeg = shutil.which("ffmpeg")
    if ffmpeg is None:
        raise AppError(
            "FFmpeg is not available on this system.",
            code="ffmpeg_missing",
            status_code=503,
        )
    if not video_path.is_file():
        raise AppError(
            "Source video file is missing.",
            code="video_not_found",
            status_code=404,
        )

    audio_path.parent.mkdir(parents=True, exist_ok=True)
    command = build_ffmpeg_command(video_path, audio_path, ffmpeg)

    try:
        result = subprocess.run(
            command,
            capture_output=True,
            text=True,
            timeout=60 * 60,  # 1 hour ceiling for very long sermons
            check=False,
        )
    except (OSError, subprocess.SubprocessError) as exc:
        raise AppError(
            f"Failed to run FFmpeg: {exc}",
            code="audio_extraction_failed",
            status_code=500,
        ) from exc

    if result.returncode != 0 or not audio_path.is_file():
        raise AppError(
            "FFmpeg could not extract audio from the video.",
            code="audio_extraction_failed",
            status_code=422,
        )
    return audio_path
