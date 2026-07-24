"""Detect format and dispatch to the appropriate transcript parser."""

from __future__ import annotations

from pathlib import Path

from app.core.exceptions import ValidationAppError
from app.models.transcript import TranscriptSource
from app.services.transcripts.parse_json import parse_json_transcript
from app.services.transcripts.parse_srt import parse_srt
from app.services.transcripts.parse_txt import parse_txt
from app.services.transcripts.parse_vtt import parse_vtt
from app.services.transcripts.types import ParsedTranscript
from app.services.transcripts.validate import validate_parsed_transcript

_EXTENSION_SOURCE: dict[str, TranscriptSource] = {
    ".srt": TranscriptSource.uploaded_srt,
    ".vtt": TranscriptSource.uploaded_vtt,
    ".json": TranscriptSource.uploaded_json,
    ".txt": TranscriptSource.uploaded_txt,
}


def detect_source(filename: str | None, content: str) -> TranscriptSource:
    """Infer transcript source from extension, with content-based fallback."""
    extension = Path(filename or "").suffix.lower()
    if extension in _EXTENSION_SOURCE:
        return _EXTENSION_SOURCE[extension]

    stripped = content.lstrip("\ufeff").lstrip()
    if stripped.startswith("WEBVTT"):
        return TranscriptSource.uploaded_vtt
    if stripped.startswith("{") or stripped.startswith("["):
        return TranscriptSource.uploaded_json
    # Heuristic: presence of --> with SRT-like commas suggests SRT.
    if "-->" in stripped and "," in stripped.split("-->", maxsplit=1)[0][-12:]:
        return TranscriptSource.uploaded_srt
    if "-->" in stripped:
        return TranscriptSource.uploaded_vtt
    return TranscriptSource.uploaded_txt


def parse_transcript_file(
    filename: str | None,
    content: str,
) -> tuple[TranscriptSource, ParsedTranscript]:
    """Parse an uploaded transcript and validate timing constraints."""
    source = detect_source(filename, content)
    if source is TranscriptSource.uploaded_srt:
        parsed = parse_srt(content)
    elif source is TranscriptSource.uploaded_vtt:
        parsed = parse_vtt(content)
    elif source is TranscriptSource.uploaded_json:
        parsed = parse_json_transcript(content)
    elif source is TranscriptSource.uploaded_txt:
        parsed = parse_txt(content)
    else:
        raise ValidationAppError(
            f"Unsupported transcript source: {source}",
            code="unsupported_transcript_format",
        )

    validate_parsed_transcript(parsed)
    return source, parsed
