"""Shared conversion from persisted transcripts to provider-safe timed input."""

from __future__ import annotations

from app.models.transcript import Transcript
from app.services.ai.schemas import TranscriptSegmentInput, TranscriptWordInput


def transcript_to_ai_inputs(transcript: Transcript) -> list[TranscriptSegmentInput]:
    items: list[TranscriptSegmentInput] = []
    for segment in sorted(transcript.segments, key=lambda item: item.order):
        if segment.start_seconds is None or segment.end_seconds is None:
            continue
        words = [
            TranscriptWordInput(
                start=float(word.start_seconds),
                end=float(word.end_seconds),
                text=word.text,
            )
            for word in sorted(segment.words, key=lambda item: item.order)
            if word.start_seconds is not None and word.end_seconds is not None
        ]
        items.append(
            TranscriptSegmentInput(
                order=segment.order,
                start=float(segment.start_seconds),
                end=float(segment.end_seconds),
                text=segment.text,
                words=words,
            )
        )
    return items
