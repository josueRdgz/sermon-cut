"""Validate normalized transcript timing constraints."""

from __future__ import annotations

import math

from app.core.exceptions import ValidationAppError
from app.services.transcripts.types import ParsedSegment, ParsedTranscript


def _require_finite(value: float | None, *, label: str) -> None:
    if value is None:
        return
    if not math.isfinite(value):
        raise ValidationAppError(
            f"{label}: el tiempo debe ser un número finito (no NaN ni Infinity).",
            code="non_finite_timestamp",
        )


def _check_span(start: float | None, end: float | None, *, label: str) -> None:
    if start is None and end is None:
        return
    _require_finite(start, label=label)
    _require_finite(end, label=label)
    if start is None or end is None:
        raise ValidationAppError(
            f"{label}: inicio y fin deben estar definidos juntos.",
            code="incomplete_timing",
        )
    if start < 0 or end < 0:
        raise ValidationAppError(
            f"{label}: los tiempos no pueden ser negativos (recibido {start}–{end}).",
            code="negative_timestamp",
        )
    if start >= end:
        raise ValidationAppError(
            f"{label}: el inicio ({start}) debe ser menor que el fin ({end}).",
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
            "La transcripción no tiene segmentos.",
            code="empty_transcript",
        )

    if not parsed.has_timing:
        # Unsynced TXT: segments may omit times entirely.
        for index, segment in enumerate(parsed.segments):
            if segment.start is not None or segment.end is not None:
                _check_span(segment.start, segment.end, label=f"Segmento {index + 1}")
        return

    previous_end: float | None = None
    previous_start: float | None = None

    for index, segment in enumerate(parsed.segments):
        label = f"Segmento {index + 1}"
        _check_span(segment.start, segment.end, label=label)
        assert segment.start is not None and segment.end is not None

        if previous_start is not None and segment.start < previous_start:
            raise ValidationAppError(
                f"{label}: los segmentos deben estar ordenados por tiempo de inicio.",
                code="unordered_segments",
            )
        if previous_end is not None and segment.start < previous_end:
            raise ValidationAppError(
                f"{label}: se solapa con el segmento anterior que termina en {previous_end}.",
                code="overlapping_segments",
            )

        for word_index, word in enumerate(segment.words):
            word_label = f"{label} palabra {word_index + 1}"
            _check_span(word.start, word.end, label=word_label)
            if word.start is not None and word.end is not None:
                if word.start < segment.start or word.end > segment.end:
                    raise ValidationAppError(
                        f"{word_label}: el tiempo de la palabra debe quedar dentro del segmento.",
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
    max_duration_seconds: float | None = None,
    allow_neighbor_adjust: bool = False,
) -> None:
    """Validate a single segment timing edit against neighbors and duration.

    When ``allow_neighbor_adjust`` is True, overlapping neighbors are treated as
    candidates for transactional boundary adjustment in the service layer rather
    than hard errors — but only when the neighbor would remain a valid span.
    """
    _check_span(start_seconds, end_seconds, label="Segmento")
    if start_seconds is None or end_seconds is None:
        return

    if max_duration_seconds is not None and math.isfinite(max_duration_seconds):
        if end_seconds > max_duration_seconds + 1e-6:
            raise ValidationAppError(
                f"El fin ({end_seconds}) supera la duración del video "
                f"({max_duration_seconds}).",
                code="beyond_video_duration",
            )
        if start_seconds > max_duration_seconds + 1e-6:
            raise ValidationAppError(
                f"El inicio ({start_seconds}) supera la duración del video "
                f"({max_duration_seconds}).",
                code="beyond_video_duration",
            )

    if previous is not None and previous.end is not None and start_seconds < previous.end:
        if not allow_neighbor_adjust:
            raise ValidationAppError(
                "El segmento se solapa con el anterior.",
                code="overlapping_segments",
            )
        if previous.start is not None and start_seconds <= previous.start:
            raise ValidationAppError(
                "No se puede ajustar el límite compartido: "
                "el inicio invade todo el segmento anterior.",
                code="unsafe_neighbor_adjust",
            )

    if (
        next_segment is not None
        and next_segment.start is not None
        and end_seconds > next_segment.start
    ):
        if not allow_neighbor_adjust:
            raise ValidationAppError(
                "El segmento se solapa con el siguiente.",
                code="overlapping_segments",
            )
        if next_segment.end is not None and end_seconds >= next_segment.end:
            raise ValidationAppError(
                "No se puede ajustar el límite compartido: "
                "el fin invade todo el segmento siguiente.",
                code="unsafe_neighbor_adjust",
            )
