"""Extract the preaching window from a culto recording."""

from __future__ import annotations

import shutil
from pathlib import Path

from app.core.exceptions import AppError, ValidationAppError
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
    """Cut ``source`` to ``[start, end]`` with stream copy, then re-encode if needed."""
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
        _run_cut(ffmpeg, source, temp, start=start, duration=duration, copy=True, log_path=log_path)
    except FFmpegError:
        temp.unlink(missing_ok=True)
        _run_cut(
            ffmpeg,
            source,
            temp,
            start=start,
            duration=duration,
            copy=False,
            log_path=log_path,
        )
    temp.replace(destination)


def _run_cut(
    ffmpeg: str,
    source: Path,
    destination: Path,
    *,
    start: float,
    duration: float,
    copy: bool,
    log_path: Path,
) -> None:
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
    ]
    if copy:
        args.extend(["-c", "copy", "-avoid_negative_ts", "make_zero"])
    else:
        args.extend(
            [
                "-c:v",
                "libx264",
                "-preset",
                "veryfast",
                "-crf",
                "20",
                "-c:a",
                "aac",
                "-b:a",
                "160k",
                "-movflags",
                "+faststart",
            ]
        )
    args.append(str(destination))
    result = run_ffmpeg(args, log_path=log_path)
    if result.returncode != 0:
        raise FFmpegError(result.returncode, result.stderr_tail)
