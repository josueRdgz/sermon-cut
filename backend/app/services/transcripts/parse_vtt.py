"""WebVTT (.vtt) parser."""

from __future__ import annotations

import re

from app.core.exceptions import ValidationAppError
from app.services.transcripts.timing import parse_timestamp, strip_vtt_tags
from app.services.transcripts.types import ParsedSegment, ParsedTranscript

_ARROW = re.compile(r"^(?:.*\s)?(\S+)\s*-->\s*(\S+)(.*)$")


def parse_vtt(content: str) -> ParsedTranscript:
    """Parse a WebVTT document into the internal transcript format."""
    text = content.replace("\r\n", "\n").replace("\r", "\n").lstrip("\ufeff")
    lines = text.split("\n")

    if not lines or not lines[0].strip().startswith("WEBVTT"):
        raise ValidationAppError(
            "WebVTT file must start with WEBVTT.",
            code="invalid_vtt",
        )

    # Skip header (WEBVTT line + optional metadata until blank line).
    index = 1
    while index < len(lines) and lines[index].strip() != "":
        index += 1
    while index < len(lines) and lines[index].strip() == "":
        index += 1

    segments: list[ParsedSegment] = []
    while index < len(lines):
        # Skip NOTE / STYLE / REGION blocks.
        stripped = lines[index].strip()
        if stripped == "" or stripped.startswith(("NOTE", "STYLE", "REGION")):
            # Consume until blank line.
            while index < len(lines) and lines[index].strip() != "":
                index += 1
            while index < len(lines) and lines[index].strip() == "":
                index += 1
            continue

        # Optional cue identifier.
        if "-->" not in lines[index]:
            index += 1
            if index >= len(lines):
                break
            if "-->" not in lines[index]:
                raise ValidationAppError(
                    f"WebVTT cue missing timing near: {stripped!r}",
                    code="invalid_vtt",
                )

        timing_line = lines[index].strip()
        timing_match = _ARROW.match(timing_line)
        if not timing_match:
            raise ValidationAppError(
                f"Invalid WebVTT timing line: {timing_line!r}",
                code="invalid_vtt",
            )
        try:
            start = parse_timestamp(timing_match.group(1))
            end = parse_timestamp(timing_match.group(2))
        except ValidationAppError as exc:
            raise ValidationAppError(
                f"Invalid WebVTT timestamp: {timing_line!r}",
                code="invalid_vtt",
            ) from exc

        index += 1
        body_lines: list[str] = []
        while index < len(lines) and lines[index].strip() != "":
            body_lines.append(lines[index])
            index += 1

        if not body_lines:
            raise ValidationAppError(
                "WebVTT cue has timing but no text.",
                code="invalid_vtt",
            )

        # Preserve spoken text; strip only VTT markup tags.
        cue_text = "\n".join(strip_vtt_tags(line) for line in body_lines)
        segments.append(ParsedSegment(text=cue_text, start=start, end=end))

        while index < len(lines) and lines[index].strip() == "":
            index += 1

    if not segments:
        raise ValidationAppError("WebVTT file contains no cues.", code="invalid_vtt")

    return ParsedTranscript(segments=segments, has_timing=True, has_word_timestamps=False)
