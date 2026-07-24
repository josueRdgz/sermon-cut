"""Split long transcripts into timed chunks that preserve absolute clocks."""

from __future__ import annotations

from dataclasses import dataclass

from app.services.ai.schemas import AnalysisRequest, TranscriptSegmentInput


@dataclass(frozen=True)
class TranscriptChunk:
    """One context window with absolute source timestamps intact."""

    index: int
    count: int
    start: float
    end: float
    segments: list[TranscriptSegmentInput]


def chunk_segments(
    segments: list[TranscriptSegmentInput],
    *,
    char_limit: int,
) -> list[TranscriptChunk]:
    """Greedy pack by character count, never splitting a segment mid-text.

    Absolute ``start``/``end`` values are preserved so Gemini (or the mock)
    always returns times on the original video clock.
    """
    timed = [s for s in segments if s.end > s.start and s.text.strip()]
    if not timed:
        return []

    # Keep a modest floor so accidental tiny limits do not explode the call count.
    limit = max(1_000, int(char_limit))
    groups: list[list[TranscriptSegmentInput]] = []
    current: list[TranscriptSegmentInput] = []
    current_chars = 0

    for segment in timed:
        size = len(segment.text) + 24  # bracketed timestamps in the prompt
        # A single oversized segment still becomes its own chunk.
        if current and current_chars + size > limit:
            groups.append(current)
            current = []
            current_chars = 0
        current.append(segment)
        current_chars += size

    if current:
        groups.append(current)

    count = len(groups)
    return [
        TranscriptChunk(
            index=index,
            count=count,
            start=group[0].start,
            end=group[-1].end,
            segments=group,
        )
        for index, group in enumerate(groups)
    ]


def request_for_chunk(
    base: AnalysisRequest,
    chunk: TranscriptChunk,
) -> AnalysisRequest:
    """Clone the request scoped to one chunk."""
    return base.model_copy(
        update={
            "segments": chunk.segments,
            "chunk_start": chunk.start,
            "chunk_end": chunk.end,
            "chunk_index": chunk.index,
            "chunk_count": chunk.count,
        }
    )
