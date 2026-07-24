"""Internal JSON transcript parser."""

from __future__ import annotations

import json
from typing import Any

from app.core.exceptions import ValidationAppError
from app.services.transcripts.types import ParsedSegment, ParsedTranscript, ParsedWord


def _as_optional_float(value: Any, *, field: str) -> float | None:
    if value is None:
        return None
    try:
        return float(value)
    except (TypeError, ValueError) as exc:
        raise ValidationAppError(
            f"Invalid numeric value for '{field}'.",
            code="invalid_json_transcript",
        ) from exc


def parse_json_transcript(content: str) -> ParsedTranscript:
    """Parse the canonical internal JSON transcript format."""
    try:
        payload = json.loads(content)
    except json.JSONDecodeError as exc:
        raise ValidationAppError(
            f"Invalid JSON: {exc.msg}",
            code="invalid_json_transcript",
        ) from exc

    if not isinstance(payload, dict):
        raise ValidationAppError(
            "JSON transcript root must be an object.",
            code="invalid_json_transcript",
        )

    raw_segments = payload.get("segments")
    if not isinstance(raw_segments, list) or not raw_segments:
        raise ValidationAppError(
            "JSON transcript must include a non-empty 'segments' array.",
            code="invalid_json_transcript",
        )

    language = payload.get("language")
    if language is not None and not isinstance(language, str):
        raise ValidationAppError(
            "'language' must be a string when present.",
            code="invalid_json_transcript",
        )

    segments: list[ParsedSegment] = []
    has_word_timestamps = False
    has_any_timing = False

    for index, item in enumerate(raw_segments):
        if not isinstance(item, dict):
            raise ValidationAppError(
                f"Segment {index + 1} must be an object.",
                code="invalid_json_transcript",
            )
        text = item.get("text")
        if not isinstance(text, str) or text == "":
            raise ValidationAppError(
                f"Segment {index + 1} must include non-empty 'text'.",
                code="invalid_json_transcript",
            )

        start = _as_optional_float(item.get("start"), field="start")
        end = _as_optional_float(item.get("end"), field="end")
        if start is not None or end is not None:
            has_any_timing = True

        words: list[ParsedWord] = []
        raw_words = item.get("words") or []
        if raw_words and not isinstance(raw_words, list):
            raise ValidationAppError(
                f"Segment {index + 1} 'words' must be an array.",
                code="invalid_json_transcript",
            )
        for word_index, raw_word in enumerate(raw_words):
            if not isinstance(raw_word, dict):
                raise ValidationAppError(
                    f"Segment {index + 1} word {word_index + 1} must be an object.",
                    code="invalid_json_transcript",
                )
            word_text = raw_word.get("text")
            if not isinstance(word_text, str) or word_text == "":
                raise ValidationAppError(
                    f"Segment {index + 1} word {word_index + 1} needs non-empty 'text'.",
                    code="invalid_json_transcript",
                )
            w_start = _as_optional_float(raw_word.get("start"), field="word.start")
            w_end = _as_optional_float(raw_word.get("end"), field="word.end")
            confidence = _as_optional_float(raw_word.get("confidence"), field="confidence")
            if w_start is not None and w_end is not None:
                has_word_timestamps = True
            words.append(
                ParsedWord(
                    text=word_text,
                    start=w_start,
                    end=w_end,
                    confidence=confidence,
                )
            )

        segments.append(ParsedSegment(text=text, start=start, end=end, words=words))

    return ParsedTranscript(
        segments=segments,
        language=language,
        has_timing=has_any_timing,
        has_word_timestamps=has_word_timestamps,
    )
