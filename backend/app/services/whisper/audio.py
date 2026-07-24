"""Extract audio from a video into WAV mono 16 kHz using FFmpeg."""

from __future__ import annotations

import logging
import shutil
import subprocess
import threading
import time
from pathlib import Path

from app.core.exceptions import AppError

logger = logging.getLogger(__name__)

# faster-whisper expects 16 kHz mono PCM.
TARGET_SAMPLE_RATE = 16000
TARGET_CHANNELS = 1

_POLL_INTERVAL = 0.2
_TERM_GRACE = 2.0


class AudioExtractionCancelled(AppError):
    """Raised when extraction is aborted via ``cancel_event``."""

    def __init__(self) -> None:
        super().__init__(
            "Audio extraction was cancelled.",
            code="audio_extraction_cancelled",
            status_code=499,
        )


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


def extract_audio(
    video_path: Path,
    audio_path: Path,
    cancel_event: threading.Event | None = None,
) -> Path:
    """Extract ``video_path`` audio to ``audio_path`` (WAV mono 16 kHz).

    When ``cancel_event`` is set, FFmpeg is terminated (SIGTERM then SIGKILL).
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
        process = subprocess.Popen(
            command,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.PIPE,
            text=True,
        )
    except OSError as exc:
        raise AppError(
            f"Failed to run FFmpeg: {exc}",
            code="audio_extraction_failed",
            status_code=500,
        ) from exc

    deadline = time.monotonic() + 60 * 60
    try:
        while True:
            if cancel_event is not None and cancel_event.is_set():
                _terminate_process(process)
                raise AudioExtractionCancelled()
            if time.monotonic() > deadline:
                _terminate_process(process)
                raise AppError(
                    "FFmpeg audio extraction timed out.",
                    code="audio_extraction_failed",
                    status_code=500,
                )
            code = process.poll()
            if code is not None:
                break
            time.sleep(_POLL_INTERVAL)
    finally:
        if process.poll() is None:
            _terminate_process(process)

    stderr = ""
    if process.stderr is not None:
        try:
            stderr = process.stderr.read() or ""
        except OSError:
            stderr = ""

    if process.returncode != 0 or not audio_path.is_file():
        if cancel_event is not None and cancel_event.is_set():
            raise AudioExtractionCancelled()
        logger.warning("FFmpeg extract failed (code=%s): %s", process.returncode, stderr[-500:])
        raise AppError(
            "FFmpeg could not extract audio from the video.",
            code="audio_extraction_failed",
            status_code=422,
        )
    return audio_path


def _terminate_process(process: subprocess.Popen[str]) -> None:
    if process.poll() is not None:
        return
    process.terminate()
    try:
        process.wait(timeout=_TERM_GRACE)
    except subprocess.TimeoutExpired:
        process.kill()
        try:
            process.wait(timeout=1.0)
        except subprocess.TimeoutExpired:
            logger.warning("FFmpeg extract process did not exit after kill")
