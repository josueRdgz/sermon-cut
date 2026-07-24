"""Unit tests for technical cut suggestions with sample sermon transcripts."""

from __future__ import annotations

import uuid

import pytest
from app.schemas.cut_suggestions import CutIntensity, CutSuggestionKind
from app.services.cut_suggestions.engine import SegmentInput, build_suggestions
from app.services.cut_suggestions.fillers import (
    detect_filler_hits,
    tokens_from_words,
)
from app.services.cut_suggestions.intensity import get_profile
from app.services.cut_suggestions.silence import (
    SilenceInterval,
    parse_silencedetect_output,
)


def test_default_intensity_is_conservative() -> None:
    profile = get_profile(CutIntensity.conservative)
    aggressive = get_profile(CutIntensity.aggressive)
    assert profile.keep_margin > aggressive.keep_margin
    assert profile.min_silence_duration > aggressive.min_silence_duration
    assert profile.allow_contextual_fillers is False


def test_parse_silencedetect_absolute_intervals() -> None:
    output = (
        "silence_start: 0.10\n"
        "silence_end: 1.40 | silence_duration: 1.30\n"
        "silence_start: 4.00\n"
        "silence_end: 5.20 | silence_duration: 1.20\n"
    )
    intervals = parse_silencedetect_output(
        output, window_start=100.0, window_duration=10.0
    )
    assert len(intervals) == 2
    assert intervals[0].start == 100.1
    assert intervals[0].end == 101.4
    assert intervals[1].duration == pytest.approx(1.2)


def test_coherent_sermon_transcript_has_no_fillers() -> None:
    words = [
        ("La", 10.0, 10.2),
        ("gracia", 10.2, 10.6),
        ("de", 10.6, 10.7),
        ("Dios", 10.7, 11.1),
        ("es", 11.1, 11.2),
        ("suficiente", 11.2, 11.8),
        ("para", 11.8, 12.0),
        ("todo", 12.0, 12.3),
        ("pecador", 12.3, 12.8),
    ]
    tokens = tokens_from_words(words)
    hits = detect_filler_hits(
        tokens,
        profile=get_profile(CutIntensity.conservative),
        segment_start=10.0,
        segment_end=13.0,
    )
    assert hits == []


def test_detects_eh_filler_with_pause_but_not_meaningful_este() -> None:
    # «eh» with surrounding pause → safe filler
    words = [
        ("hermanos", 1.0, 1.5),
        ("eh", 2.0, 2.3),
        ("la", 2.8, 2.9),
        ("palabra", 2.9, 3.4),
    ]
    hits = detect_filler_hits(
        tokens_from_words(words),
        profile=get_profile(CutIntensity.conservative),
        segment_start=0.5,
        segment_end=4.0,
    )
    assert any(h.matched_text.lower().startswith("eh") for h in hits)

    # «este punto» must NOT be suggested even in balanced
    doctrinal = [
        ("miren", 5.0, 5.3),
        ("este", 5.4, 5.6),
        ("punto", 5.6, 6.0),
        ("con", 6.0, 6.1),
        ("cuidado", 6.1, 6.6),
    ]
    hits2 = detect_filler_hits(
        tokens_from_words(doctrinal),
        profile=get_profile(CutIntensity.balanced),
        segment_start=5.0,
        segment_end=7.0,
    )
    assert hits2 == []


def test_immediate_repetition_and_false_start() -> None:
    words = [
        ("la", 1.0, 1.1),
        ("la", 1.15, 1.3),
        ("gracia", 1.3, 1.8),
        ("sal", 2.0, 2.2),
        ("salvación", 2.35, 2.9),
    ]
    hits = detect_filler_hits(
        tokens_from_words(words),
        profile=get_profile(CutIntensity.balanced),
        segment_start=1.0,
        segment_end=3.0,
    )
    kinds = {h.kind for h in hits}
    assert "immediate_repetition" in kinds
    assert "false_start" in kinds
    assert all(h.requires_review for h in hits if h.kind != "filler_word" or True)


def test_silence_suggestions_keep_natural_margin() -> None:
    segment = SegmentInput(
        index=1,
        uuid=uuid.uuid4(),
        start=10.0,
        end=30.0,
        words=[("gracia", 12.0, 12.5), ("suficiente", 12.6, 13.2)],
    )
    silences = [
        SilenceInterval(start=10.0, end=11.8),  # leading
        SilenceInterval(start=18.0, end=20.5),  # internal long pause
        SilenceInterval(start=28.2, end=30.0),  # trailing
    ]
    profile = get_profile(CutIntensity.conservative)
    suggestions = build_suggestions(
        [segment],
        silences_by_segment={1: silences},
        profile=profile,
        intensity=CutIntensity.conservative,
        include_silence=True,
        include_fillers=False,
    )
    kinds = {s.kind for s in suggestions}
    assert CutSuggestionKind.trim_leading_silence in kinds
    assert CutSuggestionKind.trim_trailing_silence in kinds
    assert (
        CutSuggestionKind.long_pause in kinds
        or CutSuggestionKind.reduce_internal_silence in kinds
    )

    leading = next(s for s in suggestions if s.kind == CutSuggestionKind.trim_leading_silence)
    assert leading.new_start is not None
    # Speech starts ~11.8; keep_margin 0.28 → ~11.52
    assert leading.new_start == 11.8 - profile.keep_margin
    assert leading.split is False

    internal = next(
        s
        for s in suggestions
        if s.kind
        in {
            CutSuggestionKind.long_pause,
            CutSuggestionKind.reduce_internal_silence,
        }
    )
    assert internal.split is True
    assert internal.apply_crossfade_ms == profile.crossfade_ms
    assert internal.keep_before_end is not None
    assert internal.keep_after_start is not None
    # Residual silence remains — do not collapse breathing entirely.
    assert internal.keep_after_start - internal.keep_before_end >= profile.residual_silence - 0.05


def test_suggestions_never_auto_flag() -> None:
    segment = SegmentInput(
        index=1,
        uuid=uuid.uuid4(),
        start=0.0,
        end=8.0,
        words=[("eh", 1.0, 1.3), ("amén", 2.0, 2.4)],
    )
    suggestions = build_suggestions(
        [segment],
        silences_by_segment={1: [SilenceInterval(0.0, 0.95)]},
        profile=get_profile(CutIntensity.conservative),
        intensity=CutIntensity.conservative,
    )
    assert all(s.status.value == "pending" for s in suggestions)
