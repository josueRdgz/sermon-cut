"""Plain-text transcript parser (no timestamps)."""

from __future__ import annotations

from app.core.exceptions import ValidationAppError
from app.services.transcripts.types import ParsedSegment, ParsedTranscript


def parse_txt(content: str) -> ParsedTranscript:
    """Split a plain TXT file into unsynced segments.

    Blank-line-separated paragraphs become segments. If there are no blank
    lines, each non-empty line is a segment. Text is preserved exactly
    (aside from normalizing newlines).
    """
    text = content.replace("\r\n", "\n").replace("\r", "\n").lstrip("\ufeff")
    if not text.strip():
        raise ValidationAppError("Empty text transcript.", code="invalid_txt")

    paragraphs = [block for block in text.split("\n\n") if block.strip()]
    if len(paragraphs) > 1:
        bodies = paragraphs
    else:
        bodies = [line for line in text.split("\n") if line.strip()]

    if not bodies:
        raise ValidationAppError("Empty text transcript.", code="invalid_txt")

    segments = [ParsedSegment(text=body, start=None, end=None) for body in bodies]
    return ParsedTranscript(
        segments=segments,
        has_timing=False,
        has_word_timestamps=False,
    )
