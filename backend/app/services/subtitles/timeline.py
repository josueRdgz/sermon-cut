"""Map non-consecutive source windows onto the assembled output timeline.

This must stay in lockstep with ``services.render.args._join_chain``: hard cuts
append durations; crossfades shrink the total by the usable overlap. Subtitle
cues always use the *output* clock — never the original source timestamps after
segments have been joined.
"""

from __future__ import annotations

from dataclasses import dataclass

# Keep in sync with ``app.services.render.args``.
_XFADE_TRANSITIONS: frozenset[str] = frozenset(
    {
        "short_crossfade",
        "dip_to_black",
        "fade",
        "flash",
        "light_change",
        "wipe_down",
        "wipe_left",
        "slide_down",
        "dissolve",
    }
)
_MIN_XFADE_SLACK = 0.05


@dataclass(frozen=True)
class TimelineSegment:
    """One source window plus the transition that follows it."""

    source_start: float
    source_end: float
    transition_type: str = "hard_cut"
    transition_duration_ms: int = 0
    pad_before_ms: int = 0

    @property
    def duration(self) -> float:
        return max(0.0, self.source_end - self.source_start)

    @property
    def pad_before_seconds(self) -> float:
        return max(0, self.pad_before_ms) / 1000.0

    @property
    def stream_duration(self) -> float:
        return self.pad_before_seconds + self.duration


@dataclass(frozen=True)
class SegmentPlacement:
    """Where a source window lands on the final timeline."""

    index: int
    source_start: float
    source_end: float
    output_start: float
    # Length of this segment's content on the output clock (equals source duration).
    content_duration: float
    pad_before_seconds: float = 0.0


@dataclass(frozen=True)
class OutputTimeline:
    """Placements for every segment plus the final assembled duration."""

    placements: list[SegmentPlacement]
    total_duration: float


def usable_transition_seconds(
    *,
    transition_type: str,
    transition_duration_ms: int,
    timeline_so_far: float,
    next_duration: float,
) -> float:
    """Clamp a crossfade so the xfade offset stays positive (mirrors FFmpeg)."""
    if transition_type not in _XFADE_TRANSITIONS:
        return 0.0
    requested = max(0, transition_duration_ms) / 1000.0
    usable = min(
        requested,
        timeline_so_far - _MIN_XFADE_SLACK,
        next_duration - _MIN_XFADE_SLACK,
    )
    return usable if usable > 0 else 0.0


def build_output_timeline(segments: list[TimelineSegment]) -> OutputTimeline:
    """Place each source window on the final reel clock.

    Example — hard cuts only::

        A = 20 s, B = 30 s  →  A at 0, B at 20, total 50.

    With a usable 0.5 s crossfade after A, B starts at 19.5 and total is 49.5.
    """
    if not segments:
        return OutputTimeline(placements=[], total_duration=0.0)

    placements: list[SegmentPlacement] = []
    total = 0.0

    for index, segment in enumerate(segments):
        pad = segment.pad_before_seconds
        stream_duration = segment.stream_duration
        if index == 0:
            stream_start = 0.0
            total = stream_duration
        else:
            previous = segments[index - 1]
            usable = usable_transition_seconds(
                transition_type=previous.transition_type,
                transition_duration_ms=previous.transition_duration_ms,
                timeline_so_far=total,
                next_duration=stream_duration,
            )
            stream_start = total - usable if usable > 0 else total
            total = stream_start + stream_duration
        placements.append(
            SegmentPlacement(
                index=index,
                source_start=segment.source_start,
                source_end=segment.source_end,
                output_start=stream_start + pad,
                content_duration=segment.duration,
                pad_before_seconds=pad,
            )
        )

    return OutputTimeline(placements=placements, total_duration=total)


def map_source_interval(
    placement: SegmentPlacement,
    source_start: float,
    source_end: float,
) -> tuple[float, float] | None:
    """Clip a source interval to the window and map it onto the output clock.

    Returns ``None`` when the interval does not overlap the placement window.
    """
    start = max(source_start, placement.source_start)
    end = min(source_end, placement.source_end)
    if end <= start:
        return None
    out_start = placement.output_start + (start - placement.source_start)
    out_end = placement.output_start + (end - placement.source_start)
    if out_end <= out_start:
        return None
    return out_start, out_end
