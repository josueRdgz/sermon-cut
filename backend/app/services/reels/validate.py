"""Validation and duration helpers for Reel segments.

A Reel is an ordered list of *source windows* that may leave gaps in the
original video. Contiguity is never required; each window is validated on its
own against the project video duration.
"""

from __future__ import annotations

from dataclasses import dataclass

from app.core.config import get_settings
from app.core.exceptions import ValidationAppError
from app.models.reel import TransitionType


@dataclass(frozen=True)
class SegmentTiming:
    """Minimal timing view used by validators and duration math."""

    source_start_seconds: float
    source_end_seconds: float
    transition_type: TransitionType = TransitionType.hard_cut
    transition_duration_ms: int = 0


def validate_segment_timing(
    *,
    start: float,
    end: float,
    video_duration: float | None,
    min_duration: float | None = None,
    label: str = "Segment",
) -> None:
    """Enforce start < end, min duration, and containment in the source video."""
    if min_duration is None:
        min_duration = get_settings().min_reel_segment_seconds

    if start < 0 or end < 0:
        raise ValidationAppError(
            f"{label}: timestamps must not be negative (got {start}–{end}).",
            code="negative_timestamp",
        )
    if start >= end:
        raise ValidationAppError(
            f"{label}: start ({start}) must be less than end ({end}).",
            code="invalid_time_range",
        )
    duration = end - start
    if duration < min_duration:
        raise ValidationAppError(
            f"{label}: duration ({duration:.3f}s) is below the minimum "
            f"({min_duration}s).",
            code="segment_too_short",
        )
    if video_duration is not None:
        # Allow a tiny float epsilon so end == duration_seconds is accepted.
        if start > video_duration + 1e-3:
            raise ValidationAppError(
                f"{label}: start ({start}) is beyond the video duration "
                f"({video_duration}).",
                code="segment_out_of_bounds",
            )
        if end > video_duration + 1e-3:
            raise ValidationAppError(
                f"{label}: end ({end}) is beyond the video duration "
                f"({video_duration}).",
                code="segment_out_of_bounds",
            )


def validate_transition_duration(*, transition_type: TransitionType, duration_ms: int) -> None:
    if duration_ms < 0:
        raise ValidationAppError(
            "Transition duration must not be negative.",
            code="invalid_transition_duration",
        )
    if transition_type == TransitionType.hard_cut and duration_ms != 0:
        raise ValidationAppError(
            "hard_cut transitions must have duration_ms = 0.",
            code="invalid_transition_duration",
        )
    if transition_type != TransitionType.hard_cut and duration_ms <= 0:
        raise ValidationAppError(
            f"{transition_type.value} requires a positive transition_duration_ms.",
            code="invalid_transition_duration",
        )


def validate_order_sequence(orders: list[int]) -> None:
    """Require a dense 0..n-1 permutation with no duplicates."""
    if not orders:
        return
    expected = list(range(len(orders)))
    if sorted(orders) != expected:
        raise ValidationAppError(
            f"Segment order must be a contiguous sequence 0..{len(orders) - 1} "
            f"(got {sorted(orders)}).",
            code="inconsistent_order",
        )


def content_duration_seconds(segments: list[SegmentTiming]) -> float:
    """Sum of source windows only (gaps between them are *not* counted)."""
    return sum(max(0.0, s.source_end_seconds - s.source_start_seconds) for s in segments)


def total_duration_seconds(segments: list[SegmentTiming]) -> float:
    """Assembled output duration, matching the FFmpeg / subtitle timeline.

    Hard cuts sum segment durations. Crossfades *subtract* the usable overlap
    (they do not add extra time).
    """
    if not segments:
        return 0.0
    from app.services.subtitles.timeline import TimelineSegment, build_output_timeline

    timeline = build_output_timeline(
        [
            TimelineSegment(
                source_start=s.source_start_seconds,
                source_end=s.source_end_seconds,
                transition_type=s.transition_type.value,
                transition_duration_ms=s.transition_duration_ms,
            )
            for s in segments
        ]
    )
    return timeline.total_duration
