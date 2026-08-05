"""FFmpeg boundary for extracting and remuxing repaired project audio."""

from __future__ import annotations

import shutil
import threading
from pathlib import Path

from app.core.exceptions import AppError
from app.services.render.binary import locate_ffmpeg
from app.services.render.runner import FFmpegError, run_ffmpeg


def _run(
    args: list[str],
    *,
    cancel_event: threading.Event,
    log_path: Path,
    error_code: str,
    error_message: str,
) -> None:
    try:
        result = run_ffmpeg(args, cancel_event=cancel_event, log_path=log_path)
    except FFmpegError as exc:
        raise AppError(error_message, code=error_code, status_code=422) from exc
    if result.cancelled:
        raise InterruptedError("Audio repair cancelled")


def extract_pcm(
    source: Path,
    destination: Path,
    *,
    cancel_event: threading.Event,
    log_path: Path,
) -> Path:
    ffmpeg = locate_ffmpeg() or shutil.which("ffmpeg")
    if ffmpeg is None:
        raise AppError("FFmpeg is not available.", code="ffmpeg_missing", status_code=503)
    destination.parent.mkdir(parents=True, exist_ok=True)
    _run(
        [
            ffmpeg,
            "-y",
            "-i",
            str(source),
            "-map",
            "0:a:0",
            "-vn",
            "-ac",
            "2",
            "-ar",
            "48000",
            "-c:a",
            "pcm_s16le",
            "-f",
            "wav",
            "-progress",
            "pipe:1",
            "-nostats",
            str(destination),
        ],
        cancel_event=cancel_event,
        log_path=log_path,
        error_code="audio_extraction_failed",
        error_message="FFmpeg could not extract a repairable audio track.",
    )
    return destination


def repaired_video_name(source: Path) -> str:
    suffix = source.suffix.lower()
    if suffix == ".mp4":
        return "repaired-video.mp4"
    if suffix == ".mov":
        return "repaired-video.mov"
    if suffix == ".webm":
        return "repaired-video.webm"
    return "repaired-video.mkv"


def mux_repaired_audio(
    source_video: Path,
    repaired_audio: Path,
    output: Path,
    *,
    cancel_event: threading.Event,
    log_path: Path,
) -> Path:
    ffmpeg = locate_ffmpeg() or shutil.which("ffmpeg")
    if ffmpeg is None:
        raise AppError("FFmpeg is not available.", code="ffmpeg_missing", status_code=503)
    output.parent.mkdir(parents=True, exist_ok=True)
    temp_output = output.with_name(f".{output.stem}.tmp{output.suffix}")
    audio_args = ["-c:a", "aac", "-b:a", "192k"]
    if output.suffix.lower() == ".webm":
        audio_args = ["-c:a", "libopus", "-b:a", "160k"]
    try:
        _run(
            [
                ffmpeg,
                "-y",
                "-i",
                str(source_video),
                "-i",
                str(repaired_audio),
                "-map",
                "0:v:0",
                "-map",
                "1:a:0",
                "-map_metadata",
                "0",
                "-c:v",
                "copy",
                *audio_args,
                "-shortest",
                "-progress",
                "pipe:1",
                "-nostats",
                str(temp_output),
            ],
            cancel_event=cancel_event,
            log_path=log_path,
            error_code="audio_mux_failed",
            error_message="FFmpeg could not create the repaired video copy.",
        )
        temp_output.replace(output)
    except Exception:
        temp_output.unlink(missing_ok=True)
        raise
    return output
