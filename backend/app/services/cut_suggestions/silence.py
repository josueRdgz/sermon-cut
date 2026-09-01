"""FFmpeg silencedetect helpers for technical cut suggestions.

Returns absolute source-time silence intervals. Runners are injectable so unit
tests never need a real binary or media file.
"""

from __future__ import annotations

import logging
import re
import shutil
import subprocess
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path

from app.services.cut_suggestions.intensity import IntensityProfile

logger = logging.getLogger(__name__)

_SILENCE_START_RE = re.compile(r"silence_start:\s*([\d.]+)")
_SILENCE_END_RE = re.compile(
    r"silence_end:\s*([\d.]+)\s*\|\s*silence_duration:\s*([\d.]+)"
)

FFmpegRunner = Callable[[list[str]], str]


@dataclass(frozen=True)
class SilenceInterval:
    """Silence in absolute source seconds."""

    start: float
    end: float

    @property
    def duration(self) -> float:
        return max(0.0, self.end - self.start)


def _default_runner(args: list[str]) -> str:
    completed = subprocess.run(  # noqa: S603 — controlled arg list
        args,
        capture_output=True,
        text=True,
        check=False,
    )
    return (completed.stderr or "") + (completed.stdout or "")


def parse_silencedetect_output(
    output: str,
    *,
    window_start: float,
    window_duration: float,
) -> list[SilenceInterval]:
    """Parse FFmpeg silencedetect stderr into absolute source intervals."""
    intervals: list[SilenceInterval] = []
    starts = [float(m.group(1)) for m in _SILENCE_START_RE.finditer(output)]
    ends = [
        (float(m.group(1)), float(m.group(2))) for m in _SILENCE_END_RE.finditer(output)
    ]

    # Prefer paired silence_end lines (include duration).
    for silence_end, duration in ends:
        silence_start = max(0.0, silence_end - duration)
        abs_start = window_start + silence_start
        abs_end = window_start + min(silence_end, window_duration)
        if abs_end - abs_start >= 0.05:
            intervals.append(SilenceInterval(start=abs_start, end=abs_end))

    if intervals:
        return _merge(intervals)

    # Fallback: unpaired silence_start markers (open-ended until window end).
    for rel_start in starts:
        abs_start = window_start + rel_start
        abs_end = window_start + window_duration
        if abs_end - abs_start >= 0.05:
            intervals.append(SilenceInterval(start=abs_start, end=abs_end))
    return _merge(intervals)


def detect_silences(
    source: Path,
    *,
    start: float,
    end: float,
    profile: IntensityProfile,
    ffmpeg: str | None = None,
    runner: FFmpegRunner = _default_runner,
) -> list[SilenceInterval]:
    """Run silencedetect over ``[start, end)`` and return absolute intervals."""
    binary = ffmpeg or shutil.which("ffmpeg")
    duration = max(0.05, end - start)
    if binary is None or not source.is_file():
        return []

    af = (
        f"silencedetect=noise={profile.noise_db}dB:d={profile.silence_min_detect:.3f}"
    )
    args = [
        binary,
        "-hide_banner",
        "-ss",
        f"{start:.3f}",
        "-t",
        f"{duration:.3f}",
        "-i",
        str(source),
        "-af",
        af,
        "-f",
        "null",
        "-",
    ]
    timeout = min(120.0, max(20.0, duration * 3.0))
    try:
        if runner is _default_runner:
            completed = subprocess.run(  # noqa: S603 — controlled arg list
                args,
                capture_output=True,
                text=True,
                check=False,
                timeout=timeout,
            )
            output = (completed.stderr or "") + (completed.stdout or "")
        else:
            output = runner(args)
    except subprocess.TimeoutExpired:
        logger.warning("silencedetect timed out for %s", source)
        return []
    except OSError:
        logger.warning("silencedetect failed for %s", source)
        return []
    return parse_silencedetect_output(
        output, window_start=start, window_duration=duration
    )


def _merge(intervals: list[SilenceInterval]) -> list[SilenceInterval]:
    if not intervals:
        return []
    ordered = sorted(intervals, key=lambda item: item.start)
    merged: list[SilenceInterval] = [ordered[0]]
    for item in ordered[1:]:
        prev = merged[-1]
        if item.start <= prev.end + 0.05:
            merged[-1] = SilenceInterval(start=prev.start, end=max(prev.end, item.end))
        else:
            merged.append(item)
    return merged
