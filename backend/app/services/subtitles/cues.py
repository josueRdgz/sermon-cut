"""Build timed subtitle cues from a remapped reel transcript."""

from __future__ import annotations

import re
from dataclasses import dataclass

from app.services.subtitles.templates import (
    SubtitleGranularity,
    SubtitleOptions,
    get_template,
)
from app.services.subtitles.timeline import (
    SegmentPlacement,
    TimelineSegment,
    build_output_timeline,
    map_source_interval,
)

# Characters that prefer a phrase break after them.
_PHRASE_BREAK = re.compile(r"[.!?…:;]\s*$")
_WORD_SPLIT = re.compile(r"\s+")
# Strip emoji / pictographs — sober styles never show them.
_EMOJI = re.compile(
    "["
    "\U0001f300-\U0001faff"
    "\U00002700-\U000027bf"
    "\U0001f1e0-\U0001f1ff"
    "\U00002600-\U000026ff"
    "]+",
    flags=re.UNICODE,
)


@dataclass(frozen=True)
class SourceWord:
    """A word with timestamps on the *source* video clock."""

    text: str
    start: float
    end: float


@dataclass(frozen=True)
class SourceSegment:
    """A transcript segment on the source clock (optional nested words)."""

    text: str
    start: float
    end: float
    words: list[SourceWord]


@dataclass(frozen=True)
class MappedWord:
    text: str
    start: float  # output clock
    end: float


@dataclass(frozen=True)
class SubtitleCue:
    """One ASS dialogue event on the output clock."""

    start: float
    end: float
    text: str
    # For modern_highlight: the words that make up this group (output times).
    words: tuple[MappedWord, ...] = ()
    highlight: bool = False


@dataclass(frozen=True)
class CueBuildResult:
    cues: list[SubtitleCue]
    granularity_used: SubtitleGranularity
    total_duration: float


def sanitize_caption_text(text: str, *, allow_emoji: bool = False) -> str:
    cleaned = text.replace("\r", " ").replace("\n", " ").strip()
    cleaned = re.sub(r"\s+", " ", cleaned)
    if not allow_emoji:
        cleaned = _EMOJI.sub("", cleaned)
        cleaned = re.sub(r"\s+", " ", cleaned).strip()
    return cleaned


def build_cues_for_reel(
    *,
    reel_segments: list[TimelineSegment],
    transcript_segments: list[SourceSegment],
    fallback_texts: list[str | None],
    options: SubtitleOptions,
) -> CueBuildResult:
    """Remap transcript material onto the final reel timeline and split into cues.

    Words that no longer exist in ``transcript_segments`` never appear — we never
    reconstruct text from stale copies when live words are available.
    """
    timeline = build_output_timeline(reel_segments)
    if not timeline.placements:
        return CueBuildResult(cues=[], granularity_used=options.granularity, total_duration=0.0)

    template = get_template(options.style)
    mapped_words = _collect_mapped_words(timeline.placements, transcript_segments)
    has_words = bool(mapped_words)

    granularity = options.granularity
    if granularity == SubtitleGranularity.auto:
        if template.highlight_current_word and has_words:
            granularity = SubtitleGranularity.word
        elif has_words:
            granularity = SubtitleGranularity.phrase
        else:
            granularity = SubtitleGranularity.segment
    elif granularity in {SubtitleGranularity.word, SubtitleGranularity.phrase} and not has_words:
        granularity = SubtitleGranularity.segment

    if granularity == SubtitleGranularity.word:
        cues = _cues_from_word_groups(mapped_words, options)
    elif granularity == SubtitleGranularity.phrase:
        cues = _cues_from_phrases(
            mapped_words, options, template.max_lines, template.max_chars_per_line
        )
    else:
        cues = _cues_from_segments(
            timeline.placements,
            transcript_segments,
            fallback_texts,
            options,
            template.max_lines,
            template.max_chars_per_line,
        )

    if template.quote_style and options.bible_reference:
        cues = _append_reference(cues, options.bible_reference, options)

    return CueBuildResult(
        cues=cues,
        granularity_used=granularity,
        total_duration=timeline.total_duration,
    )


def _collect_mapped_words(
    placements: list[SegmentPlacement],
    transcript_segments: list[SourceSegment],
) -> list[MappedWord]:
    mapped: list[MappedWord] = []
    for placement in placements:
        for segment in transcript_segments:
            for word in segment.words:
                text = sanitize_caption_text(word.text)
                if not text:
                    continue
                if word.start is None or word.end is None:  # type: ignore[redundant-expr]
                    continue
                mapped_interval = map_source_interval(placement, word.start, word.end)
                if mapped_interval is None:
                    continue
                out_start, out_end = mapped_interval
                mapped.append(MappedWord(text=text, start=out_start, end=out_end))
    mapped.sort(key=lambda w: (w.start, w.end))
    return mapped


def _cues_from_word_groups(
    words: list[MappedWord],
    options: SubtitleOptions,
) -> list[SubtitleCue]:
    if not words:
        return []
    max_words = max(1, min(options.max_words, 6))
    cues: list[SubtitleCue] = []
    for index in range(0, len(words), max_words):
        group = words[index : index + max_words]
        start = group[0].start
        end = max(w.end for w in group)
        if end <= start:
            end = start + 0.05
        # One cue per group; ASS generator paints the current word via karaoke/\N.
        display = " ".join(_case(w.text, options.uppercase) for w in group)
        cues.append(
            SubtitleCue(
                start=start,
                end=end,
                text=display,
                words=tuple(group),
                highlight=True,
            )
        )
    return cues


def _cues_from_phrases(
    words: list[MappedWord],
    options: SubtitleOptions,
    max_lines: int,
    max_chars: int,
) -> list[SubtitleCue]:
    if not words:
        return []
    groups: list[list[MappedWord]] = []
    current: list[MappedWord] = []
    for word in words:
        current.append(word)
        text_so_far = " ".join(w.text for w in current)
        should_break = (
            _PHRASE_BREAK.search(word.text) is not None
            or len(current) >= options.max_words
            or len(text_so_far) >= max_chars * max_lines
        )
        if should_break:
            groups.append(current)
            current = []
    if current:
        groups.append(current)

    cues: list[SubtitleCue] = []
    for group in groups:
        start = group[0].start
        end = max(w.end for w in group)
        raw = " ".join(w.text for w in group)
        text = wrap_lines(
            _case(sanitize_caption_text(raw), options.uppercase),
            max_lines=max_lines,
            max_chars=max_chars,
        )
        if not text:
            continue
        cues.append(SubtitleCue(start=start, end=max(end, start + 0.05), text=text))
    return cues


def _cues_from_segments(
    placements: list[SegmentPlacement],
    transcript_segments: list[SourceSegment],
    fallback_texts: list[str | None],
    options: SubtitleOptions,
    max_lines: int,
    max_chars: int,
) -> list[SubtitleCue]:
    cues: list[SubtitleCue] = []
    for placement, fallback in zip(placements, fallback_texts, strict=False):
        overlapping = [
            seg
            for seg in transcript_segments
            if seg.end > placement.source_start and seg.start < placement.source_end
        ]
        if overlapping:
            for seg in overlapping:
                mapped = map_source_interval(placement, seg.start, seg.end)
                if mapped is None:
                    continue
                # Prefer live segment text (reflects edits / deleted words when
                # the editor rewrote the segment without word rows).
                raw = sanitize_caption_text(seg.text)
                if not raw:
                    continue
                text = wrap_lines(
                    _case(raw, options.uppercase),
                    max_lines=max_lines,
                    max_chars=max_chars,
                )
                out_start, out_end = mapped
                cues.append(
                    SubtitleCue(start=out_start, end=max(out_end, out_start + 0.05), text=text)
                )
        elif fallback:
            raw = sanitize_caption_text(fallback)
            if not raw:
                continue
            text = wrap_lines(
                _case(raw, options.uppercase),
                max_lines=max_lines,
                max_chars=max_chars,
            )
            cues.append(
                SubtitleCue(
                    start=placement.output_start,
                    end=placement.output_start + placement.content_duration,
                    text=text,
                )
            )
    cues.sort(key=lambda c: (c.start, c.end))
    return cues


def _append_reference(
    cues: list[SubtitleCue],
    reference: str,
    options: SubtitleOptions,
) -> list[SubtitleCue]:
    ref = sanitize_caption_text(reference)
    if not ref or not cues:
        return cues
    last = cues[-1]
    decorated = f"{last.text}\\N{{\\i1\\fs{_ref_size(options.font_size)}}}{ref}"
    return [*cues[:-1], SubtitleCue(start=last.start, end=last.end, text=decorated)]


def _ref_size(font_size: int) -> int:
    return max(18, int(font_size * 0.65))


def wrap_lines(text: str, *, max_lines: int, max_chars: int) -> str:
    """Wrap on whitespace / punctuation without exceeding safe line counts."""
    words = _WORD_SPLIT.split(text.strip())
    if not words or words == [""]:
        return ""
    lines: list[str] = []
    current = ""
    for word in words:
        candidate = word if not current else f"{current} {word}"
        if len(candidate) <= max_chars:
            current = candidate
            continue
        if current:
            lines.append(current)
        current = word
        if len(lines) >= max_lines:
            break
    if current and len(lines) < max_lines:
        lines.append(current)
    elif current and lines:
        # Overflow: append truncated remainder to last line with ellipsis.
        remaining = current
        last = lines[-1]
        room = max_chars - len(last) - 1
        if room > 3:
            lines[-1] = f"{last} {remaining[: room - 1]}…"
        else:
            lines[-1] = last[: max(1, max_chars - 1)] + "…"
    return "\\N".join(lines[:max_lines])


def _case(text: str, uppercase: bool) -> str:
    return text.upper() if uppercase else text
