"""SubRip (.srt) parser."""

from __future__ import annotations

import re

from app.core.exceptions import ValidationAppError
from app.services.transcripts.timing import parse_timestamp
from app.services.transcripts.types import ParsedSegment, ParsedTranscript

_ARROW = re.compile(r"^\s*(.+?)\s*-->\s*(.+?)\s*$")
_INDEX = re.compile(r"^\d+$")


def parse_srt(content: str) -> ParsedTranscript:
    """Parse an SRT document into the internal transcript format.

    Preserves cue text exactly (aside from normalizing newlines within a cue to
    a single space-joined multi-line string with ``\\n`` kept between lines).
    """
    # Normalize newlines; strip UTF-8 BOM if present.
    text = content.replace("\r\n", "\n").replace("\r", "\n").lstrip("\ufeff")
    blocks = re.split(r"\n\s*\n", text.strip())
    if not blocks or (len(blocks) == 1 and not blocks[0].strip()):
        raise ValidationAppError("Empty or invalid SRT file.", code="invalid_srt")

    segments: list[ParsedSegment] = []
    for block in blocks:
        lines = block.split("\n")
        # Remove trailing empty lines from block.
        while lines and lines[-1] == "":
            lines.pop()
        if not lines:
            continue

        cursor = 0
        if _INDEX.match(lines[0].strip()):
            cursor = 1
        if cursor >= len(lines):
            raise ValidationAppError(
                f"SRT cue missing timing line near: {block[:60]!r}",
                code="invalid_srt",
            )

        timing_match = _ARROW.match(lines[cursor].strip())
        if not timing_match:
            raise ValidationAppError(
                f"SRT cue missing '-->' timing: {lines[cursor]!r}",
                code="invalid_srt",
            )

        start_raw = timing_match.group(1).strip()
        end_raw = timing_match.group(2).strip().split()[0]  # drop optional position settings
        try:
            start = parse_timestamp(start_raw)
            end = parse_timestamp(end_raw)
        except ValidationAppError as exc:
            raise ValidationAppError(
                f"Invalid SRT timestamp in cue: {lines[cursor]!r}",
                code="invalid_srt",
            ) from exc

        body_lines = lines[cursor + 1 :]
        if not body_lines:
            raise ValidationAppError(
                "SRT cue has timing but no text.",
                code="invalid_srt",
            )
        # Preserve exact text including internal newlines.
        cue_text = "\n".join(body_lines)
        segments.append(ParsedSegment(text=cue_text, start=start, end=end))

    if not segments:
        raise ValidationAppError("SRT file contains no cues.", code="invalid_srt")

    return ParsedTranscript(segments=segments, has_timing=True, has_word_timestamps=False)
