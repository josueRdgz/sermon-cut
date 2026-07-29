"""Lightweight media probes for volume / silence / framing jumps across joins.

Uses FFmpeg when available. All runners are injectable so unit tests never need
a real binary or video file.
"""

from __future__ import annotations

import logging
import re
import shutil
import subprocess
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path

from app.schemas.coherence import CoherenceIssue, CoherenceSeverity
from app.services.coherence.rules import SegmentView

logger = logging.getLogger(__name__)

_MEAN_VOLUME_RE = re.compile(r"mean_volume:\s*([-\d.]+)\s*dB")
_MAX_VOLUME_RE = re.compile(r"max_volume:\s*([-\d.]+)\s*dB")
_SILENCE_END_RE = re.compile(
    r"silence_end:\s*([\d.]+)\s*\|\s*silence_duration:\s*([\d.]+)"
)


@dataclass(frozen=True)
class SegmentAudioStats:
    mean_volume_db: float | None
    max_volume_db: float | None
    leading_silence: float
    trailing_silence: float


@dataclass(frozen=True)
class SegmentFrameStats:
    mean_luma: float | None


FFmpegRunner = Callable[[list[str]], str]


def _default_runner(args: list[str]) -> str:
    completed = subprocess.run(  # noqa: S603 — args are a controlled list
        args,
        capture_output=True,
        text=True,
        check=False,
    )
    return (completed.stderr or "") + (completed.stdout or "")


def probe_segment_audio(
    source: Path,
    *,
    start: float,
    end: float,
    ffmpeg: str | None = None,
    runner: FFmpegRunner = _default_runner,
) -> SegmentAudioStats:
    binary = ffmpeg or shutil.which("ffmpeg")
    duration = max(0.05, end - start)
    if binary is None:
        return SegmentAudioStats(None, None, 0.0, 0.0)

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
        "silencedetect=noise=-35dB:d=0.25,volumedetect",
        "-f",
        "null",
        "-",
    ]
    try:
        output = runner(args)
    except OSError:
        logger.warning("FFmpeg audio probe failed for %s", source)
        return SegmentAudioStats(None, None, 0.0, 0.0)

    mean = _parse_float(_MEAN_VOLUME_RE.search(output))
    peak = _parse_float(_MAX_VOLUME_RE.search(output))
    leading = 0.0
    trailing = 0.0
    # silencedetect reports absolute times within the trimmed window.
    silences = [
        (float(match.group(1)) - float(match.group(2)), float(match.group(1)))
        for match in _SILENCE_END_RE.finditer(output)
    ]
    for silence_start, silence_end in silences:
        if silence_start <= 0.05:
            leading = max(leading, min(silence_end, duration))
        if silence_end >= duration - 0.05:
            trailing = max(trailing, duration - max(0.0, silence_start))
    return SegmentAudioStats(mean, peak, leading, trailing)


def probe_segment_frame(
    source: Path,
    *,
    at_seconds: float,
    ffmpeg: str | None = None,
    runner: FFmpegRunner = _default_runner,
) -> SegmentFrameStats:
    """Sample one frame and estimate mean luma from the signalstats filter."""
    binary = ffmpeg or shutil.which("ffmpeg")
    if binary is None:
        return SegmentFrameStats(None)
    args = [
        binary,
        "-hide_banner",
        "-ss",
        f"{max(0.0, at_seconds):.3f}",
        "-i",
        str(source),
        "-frames:v",
        "1",
        "-vf",
        "signalstats,metadata=print",
        "-f",
        "null",
        "-",
    ]
    try:
        output = runner(args)
    except OSError:
        return SegmentFrameStats(None)
    match = re.search(r"lavfi\.signalstats\.YAVG=([\d.]+)", output)
    return SegmentFrameStats(_parse_float(match))


def check_media_joins(
    segments: list[SegmentView],
    *,
    source: Path | None,
    ffmpeg: str | None = None,
    runner: FFmpegRunner = _default_runner,
    volume_jump_db: float = 8.0,
    luma_jump: float = 28.0,
) -> list[CoherenceIssue]:
    """Compare consecutive windows for loudness / silence / framing jumps."""
    if source is None or not source.is_file() or len(segments) < 2:
        return []

    issues: list[CoherenceIssue] = []
    audio_stats = [
        probe_segment_audio(
            source, start=seg.start, end=seg.end, ffmpeg=ffmpeg, runner=runner
        )
        for seg in segments
    ]
    frame_stats = [
        probe_segment_frame(
            source,
            at_seconds=(seg.start + seg.end) / 2.0,
            ffmpeg=ffmpeg,
            runner=runner,
        )
        for seg in segments
    ]

    for prev, nxt, a_prev, a_next, f_prev, f_next in zip(
        segments,
        segments[1:],
        audio_stats,
        audio_stats[1:],
        frame_stats,
        frame_stats[1:],
        strict=False,
    ):
        has_soft_transition = prev.transition_type != "hard_cut"
        if (
            not has_soft_transition
            and a_prev.mean_volume_db is not None
            and a_next.mean_volume_db is not None
            and abs(a_prev.mean_volume_db - a_next.mean_volume_db) >= volume_jump_db
        ):
            issues.append(
                CoherenceIssue(
                    severity=CoherenceSeverity.warning,
                    code="VOLUME_JUMP",
                    message=(
                        f"Salto de volumen entre los fragmentos {prev.index} y "
                        f"{nxt.index} "
                        f"({a_prev.mean_volume_db:.1f} dB → {a_next.mean_volume_db:.1f} dB)."
                    ),
                    segment_id=nxt.index,
                    recommendation=(
                        "Normaliza el audio en el render o elige un empalme con "
                        "nivel más parejo."
                    ),
                )
            )

        if (
            not has_soft_transition
            and a_prev.trailing_silence >= 0.45
            and a_next.leading_silence >= 0.45
        ):
            issues.append(
                CoherenceIssue(
                    severity=CoherenceSeverity.warning,
                    code="JOIN_NOISE_OR_SILENCE",
                    message=(
                        f"El empalme hacia el fragmento {nxt.index} acumula silencios "
                        f"artificiales "
                        f"({a_prev.trailing_silence:.2f}s al final + "
                        f"{a_next.leading_silence:.2f}s al inicio)."
                    ),
                    segment_id=nxt.index,
                    recommendation="Recorta los silencios de borde o usa un fundido corto.",
                )
            )

        if (
            not has_soft_transition
            and f_prev.mean_luma is not None
            and f_next.mean_luma is not None
            and abs(f_prev.mean_luma - f_next.mean_luma) >= luma_jump
        ):
            issues.append(
                CoherenceIssue(
                    severity=CoherenceSeverity.warning,
                    code="FRAMING_JUMP",
                    message=(
                        f"Cambio fuerte de plano/iluminación entre los fragmentos "
                        f"{prev.index} y {nxt.index}."
                    ),
                    segment_id=nxt.index,
                    recommendation=(
                        "Revisa si el salto visual confunde; considera un fundido "
                        "a negro o un puente."
                    ),
                )
            )

    return issues


def _parse_float(match: re.Match[str] | None) -> float | None:
    if match is None:
        return None
    try:
        return float(match.group(1))
    except (TypeError, ValueError):
        return None
