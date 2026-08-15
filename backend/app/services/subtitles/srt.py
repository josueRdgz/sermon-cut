"""Create sidecar SRT subtitles from the same semantic output timeline as ASS."""

from __future__ import annotations

from app.models.reel import Reel
from app.models.transcript import Transcript
from app.services.subtitles import options_for_reel, transcript_to_source_segments
from app.services.subtitles.cues import build_cues_for_reel
from app.services.subtitles.timeline import TimelineSegment


def render_srt_for_reel(reel: Reel, transcript: Transcript | None) -> str:
    ordered = sorted(reel.segments, key=lambda item: item.order)
    timeline = [
        TimelineSegment(
            source_start=item.source_start_seconds,
            source_end=item.source_end_seconds,
            transition_type=(
                item.transition_type.value
                if hasattr(item.transition_type, "value")
                else str(item.transition_type)
            ),
            transition_duration_ms=item.transition_duration_ms,
        )
        for item in ordered
    ]
    result = build_cues_for_reel(
        reel_segments=timeline,
        transcript_segments=transcript_to_source_segments(transcript),
        fallback_texts=[
            (
                item.transcript_text.strip()
                if item.transcript_text and item.transcript_text.strip()
                else None
            )
            for item in ordered
        ],
        options=options_for_reel(reel),
    )
    blocks = []
    for index, cue in enumerate(result.cues, start=1):
        blocks.append(
            f"{index}\n{_timestamp(cue.start)} --> {_timestamp(cue.end)}\n{cue.text.strip()}"
        )
    return "\n\n".join(blocks) + ("\n" if blocks else "")


def _timestamp(seconds: float) -> str:
    milliseconds = max(0, round(seconds * 1000))
    hours, remainder = divmod(milliseconds, 3_600_000)
    minutes, remainder = divmod(remainder, 60_000)
    secs, millis = divmod(remainder, 1000)
    return f"{hours:02d}:{minutes:02d}:{secs:02d},{millis:03d}"
