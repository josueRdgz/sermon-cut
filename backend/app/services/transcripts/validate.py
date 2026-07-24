"""Validate normalized transcript timing constraints."""

from __future__ import annotations

from app.core.exceptions import ValidationAppError
from app.services.transcripts.types import ParsedSegment, ParsedTranscript


def _check_span(start: float | None, end: float | None, *, label: str) -> None:
    if start is None and end is None:
        return
    if start is None or end is None:
        raise ValidationAppError(
            f"{label}: both start and end must be set when timing is present.",
            code="incomplete_timing",
        )
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


def validate_parsed_transcript(parsed: ParsedTranscript) -> None:
    """Enforce timing rules on a parsed transcript.

    Rules for timed transcripts:
    - no negative timestamps
    - start < end for every timed span
    - segments ordered by start time
    - no overlapping segments (touching endpoints are allowed)
    """
    if not parsed.segments:
        raise ValidationAppError(
            "Transcript has no segments.",
            code="empty_transcript",
        )

    if not parsed.has_timing:
        # Unsynced TXT: segments may omit times entirely.
        for index, segment in enumerate(parsed.segments):
            if segment.start is not None or segment.end is not None:
                _check_span(segment.start, segment.end, label=f"Segment {index + 1}")
        return

    previous_end: float | None = None
    previous_start: float | None = None

    for index, segment in enumerate(parsed.segments):
        label = f"Segment {index + 1}"
        _check_span(segment.start, segment.end, label=label)
        assert segment.start is not None and segment.end is not None

        if previous_start is not None and segment.start < previous_start:
            raise ValidationAppError(
                f"{label}: segments must be ordered by start time.",
                code="unordered_segments",
            )
        if previous_end is not None and segment.start < previous_end:
            raise ValidationAppError(
                f"{label}: overlaps previous segment ending at {previous_end}.",
                code="overlapping_segments",
            )

        for word_index, word in enumerate(segment.words):
            word_label = f"{label} word {word_index + 1}"
            _check_span(word.start, word.end, label=word_label)
            if word.start is not None and word.end is not None:
                if word.start < segment.start or word.end > segment.end:
                    raise ValidationAppError(
                        f"{word_label}: word timing must lie within its segment.",
                        code="word_out_of_segment",
                    )

        previous_start = segment.start
        previous_end = segment.end


def validate_segment_edit(
    *,
    start_seconds: float | None,
    end_seconds: float | None,
    previous: ParsedSegment | None = None,
    next_segment: ParsedSegment | None = None,
) -> None:
    """Validate a single segment timing edit against neighbors."""
    _check_span(start_seconds, end_seconds, label="Segment")
    if start_seconds is None or end_seconds is None:
        return
    if previous is not None and previous.end is not None and start_seconds < previous.end:
        raise ValidationAppError(
            "Edited segment overlaps the previous one.",
            code="overlapping_segments",
        )
    if (
        next_segment is not None
        and next_segment.start is not None
        and end_seconds > next_segment.start
    ):
        raise ValidationAppError(
            "Edited segment overlaps the next one.",
            code="overlapping_segments",
        )
