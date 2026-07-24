"""Unit tests for Reel segment validation and duration math."""

from __future__ import annotations

import pytest
from app.core.exceptions import ValidationAppError
from app.models.reel import TransitionType
from app.services.reels.validate import (
    SegmentTiming,
    content_duration_seconds,
    total_duration_seconds,
    validate_order_sequence,
    validate_segment_timing,
    validate_transition_duration,
)


def test_validate_start_less_than_end() -> None:
    with pytest.raises(ValidationAppError) as exc:
        validate_segment_timing(start=10.0, end=10.0, video_duration=60.0)
    assert exc.value.code == "invalid_time_range"


def test_validate_negative_rejected() -> None:
    with pytest.raises(ValidationAppError) as exc:
        validate_segment_timing(start=-1.0, end=2.0, video_duration=60.0)
    assert exc.value.code == "negative_timestamp"


def test_validate_min_duration() -> None:
    with pytest.raises(ValidationAppError) as exc:
        validate_segment_timing(
            start=1.0, end=1.1, video_duration=60.0, min_duration=0.5
        )
    assert exc.value.code == "segment_too_short"


def test_validate_within_video() -> None:
    validate_segment_timing(start=10.0, end=20.0, video_duration=60.0)
    with pytest.raises(ValidationAppError) as exc:
        validate_segment_timing(start=50.0, end=70.0, video_duration=60.0)
    assert exc.value.code == "segment_out_of_bounds"


def test_non_contiguous_segments_are_valid_individually() -> None:
    # Gaps between segments are intentional — each window is checked alone.
    validate_segment_timing(start=10.2, end=10.42, video_duration=900.0, min_duration=0.1)
    validate_segment_timing(start=11.05, end=11.29, video_duration=900.0, min_duration=0.1)
    validate_segment_timing(start=12.01, end=12.18, video_duration=900.0, min_duration=0.1)


def test_order_must_be_dense_permutation() -> None:
    validate_order_sequence([0, 1, 2])
    with pytest.raises(ValidationAppError) as exc:
        validate_order_sequence([0, 2, 3])
    assert exc.value.code == "inconsistent_order"
    with pytest.raises(ValidationAppError):
        validate_order_sequence([0, 0, 1])


def test_hard_cut_requires_zero_ms() -> None:
    validate_transition_duration(transition_type=TransitionType.hard_cut, duration_ms=0)
    with pytest.raises(ValidationAppError):
        validate_transition_duration(
            transition_type=TransitionType.hard_cut, duration_ms=200
        )


def test_crossfade_requires_positive_ms() -> None:
    validate_transition_duration(
        transition_type=TransitionType.short_crossfade, duration_ms=250
    )
    with pytest.raises(ValidationAppError):
        validate_transition_duration(
            transition_type=TransitionType.dip_to_black, duration_ms=0
        )


def test_duration_matches_ffmpeg_timeline() -> None:
    segments = [
        SegmentTiming(10.0, 20.0, TransitionType.short_crossfade, 500),
        SegmentTiming(45.0, 55.0, TransitionType.dip_to_black, 300),
        SegmentTiming(80.0, 90.0, TransitionType.hard_cut, 0),
    ]
    # Content: 10 + 10 + 10 = 30; crossfades *subtract* usable overlap: 0.5 + 0.3
    assert content_duration_seconds(segments) == pytest.approx(30.0)
    assert total_duration_seconds(segments) == pytest.approx(29.2)
    assert total_duration_seconds(segments[:1]) == pytest.approx(10.0)

    hard_cuts = [
        SegmentTiming(0.0, 20.0, TransitionType.hard_cut, 0),
        SegmentTiming(40.0, 70.0, TransitionType.hard_cut, 0),
    ]
    # A=20s then B=30s → B starts at 20, total 50.
    assert total_duration_seconds(hard_cuts) == pytest.approx(50.0)
