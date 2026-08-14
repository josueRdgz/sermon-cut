"""Extract the preaching window from a culto recording."""

from __future__ import annotations

import shutil
from pathlib import Path

from app.core.exceptions import AppError, ValidationAppError
from app.services.audio_integrity import (
    START_DRIFT_SECONDS,
    heal_program_audio,
    probe_av_alignment,
)
from app.services.render.binary import locate_ffmpeg
from app.services.render.runner import FFmpegError, run_ffmpeg

_NEARLY_FULL = 0.75


def should_trim(*, start: float, end: float, duration: float) -> bool:
    """Skip FFmpeg when the chosen window is already the whole file."""
    if duration <= 0:
        return False
    if start > _NEARLY_FULL:
        return True
    return (end - start) < (duration - _NEARLY_FULL)


def extract_window(source: Path, destination: Path, *, start: float, end: float) -> None:
    """Cut ``source`` to ``[start, end]`` while preserving the original audio bitstream.

    Prefer stream copy. If that leaves a real A/V start drift, re-cut with an
    accurate seek and ``-c:a copy`` so speech is not re-encoded. Audio is only
    re-encoded when the container refuses a copy.
    """
    duration = end - start
    if duration < 1.0:
        raise ValidationAppError(
            "El intervalo de la predicación debe durar al menos 1 segundo.",
            code="sermon_range_too_short",
        )
    ffmpeg = locate_ffmpeg() or shutil.which("ffmpeg")
    if ffmpeg is None:
        raise AppError("FFmpeg is not available.", code="ffmpeg_missing", status_code=503)

    log_path = destination.with_suffix(".log")
    temp = destination.with_name(f"{destination.stem}.building{destination.suffix}")
    temp.unlink(missing_ok=True)
    try:
        try:
            _run_cut(
                ffmpeg,
                source,
                temp,
                start=start,
                duration=duration,
                mode="copy",
                log_path=log_path,
            )
        except FFmpegError:
            temp.unlink(missing_ok=True)
            _run_cut(
                ffmpeg,
                source,
                temp,
                start=start,
                duration=duration,
                mode="accurate_audio_copy",
                log_path=log_path,
            )

        alignment = probe_av_alignment(temp)
        if (
            alignment is not None
            and alignment.needs_heal()
            and alignment.start_drift > START_DRIFT_SECONDS
        ):
            # Keyframe copy often starts picture early/late vs audio. Rebuild with
            # input-accurate seek while keeping the original AAC/Opus bitstream.
            temp.unlink(missing_ok=True)
            try:
                _run_cut(
                    ffmpeg,
                    source,
                    temp,
                    start=start,
                    duration=duration,
                    mode="accurate_audio_copy",
                    log_path=log_path,
                )
            except FFmpegError:
                temp.unlink(missing_ok=True)
                _run_cut(
                    ffmpeg,
                    source,
                    temp,
                    start=start,
                    duration=duration,
                    mode="reencode",
                    log_path=log_path,
                )

        heal_program_audio(temp)
        temp.replace(destination)
    except Exception:
        temp.unlink(missing_ok=True)
        raise


def _run_cut(
    ffmpeg: str,
    source: Path,
    destination: Path,
    *,
    start: float,
    duration: float,
    mode: str,
    log_path: Path,
) -> None:
    if mode == "accurate_audio_copy":
        # Seek after -i so audio/video clocks start together; copy audio bytes.
        args = [
            ffmpeg,
            "-y",
            "-hide_banner",
            "-loglevel",
            "error",
            "-i",
            str(source),
            "-ss",
            f"{start:.3f}",
            "-t",
            f"{duration:.3f}",
            "-c:v",
            "libx264",
            "-preset",
            "veryfast",
            "-crf",
            "18",
            "-c:a",
            "copy",
            "-movflags",
            "+faststart",
            "-avoid_negative_ts",
            "make_zero",
            str(destination),
        ]
    elif mode == "copy":
        args = [
            ffmpeg,
            "-y",
            "-hide_banner",
            "-loglevel",
            "error",
            "-ss",
            f"{start:.3f}",
            "-i",
            str(source),
            "-t",
            f"{duration:.3f}",
            "-c",
            "copy",
            "-avoid_negative_ts",
            "make_zero",
            str(destination),
        ]
    else:
        args = [
            ffmpeg,
            "-y",
            "-hide_banner",
            "-loglevel",
            "error",
            "-i",
            str(source),
            "-ss",
            f"{start:.3f}",
            "-t",
            f"{duration:.3f}",
            "-c:v",
            "libx264",
            "-preset",
            "veryfast",
            "-crf",
            "18",
            "-c:a",
            "aac",
            "-b:a",
            "320k",
            "-movflags",
            "+faststart",
            "-avoid_negative_ts",
            "make_zero",
            str(destination),
        ]
    result = run_ffmpeg(args, log_path=log_path)
    if result.returncode != 0:
        raise FFmpegError(result.returncode, result.stderr_tail)
