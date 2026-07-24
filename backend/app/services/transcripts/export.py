"""Export normalized transcripts to SRT, WebVTT and internal JSON."""

from __future__ import annotations

import json

from app.core.exceptions import ValidationAppError
from app.models.transcript import Transcript
from app.schemas.transcript import ExportSegment, ExportTranscript, ExportWord
from app.services.transcripts.timing import format_timestamp_srt, format_timestamp_vtt


def to_export_model(transcript: Transcript) -> ExportTranscript:
    """Build the canonical JSON export model from ORM entities."""
    segments: list[ExportSegment] = []
    for segment in sorted(transcript.segments, key=lambda s: s.order):
        words = [
            ExportWord(
                start=word.start_seconds,
                end=word.end_seconds,
                text=word.text,
                confidence=word.confidence,
            )
            for word in sorted(segment.words, key=lambda w: w.order)
        ]
        segments.append(
            ExportSegment(
                start=segment.start_seconds,
                end=segment.end_seconds,
                text=segment.text,
                words=words,
            )
        )
    return ExportTranscript(language=transcript.language, segments=segments)


def export_json(transcript: Transcript) -> str:
    model = to_export_model(transcript)
    return json.dumps(model.model_dump(exclude_none=False), ensure_ascii=False, indent=2)


def export_srt(transcript: Transcript) -> str:
    lines: list[str] = []
    ordered = sorted(transcript.segments, key=lambda s: s.order)
    timed = [s for s in ordered if s.start_seconds is not None]
    if not timed:
        raise ValidationAppError(
            "Cannot export unsynced transcript as SRT.",
            code="unsynced_export",
        )
    for index, segment in enumerate(timed, start=1):
        assert segment.end_seconds is not None
        start = format_timestamp_srt(segment.start_seconds)
        end = format_timestamp_srt(segment.end_seconds)
        lines.append(str(index))
        lines.append(f"{start} --> {end}")
        lines.append(segment.text)
        lines.append("")
    return "\n".join(lines).rstrip() + "\n"


def export_vtt(transcript: Transcript) -> str:
    ordered = sorted(transcript.segments, key=lambda s: s.order)
    timed = [s for s in ordered if s.start_seconds is not None]
    if not timed:
        raise ValidationAppError(
            "Cannot export unsynced transcript as WebVTT.",
            code="unsynced_export",
        )
    lines = ["WEBVTT", ""]
    for segment in timed:
        assert segment.end_seconds is not None
        start = format_timestamp_vtt(segment.start_seconds)
        end = format_timestamp_vtt(segment.end_seconds)
        lines.append(f"{start} --> {end}")
        lines.append(segment.text)
        lines.append("")
    return "\n".join(lines)
