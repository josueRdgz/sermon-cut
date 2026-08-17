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


def _caption_tokens(text: str) -> list[str]:
    return [token for token in sanitize_caption_text(text).split() if token]


def _synthesize_mapped_words(tokens: list[str], start: float, end: float) -> list[MappedWord]:
    """Pack caption tokens evenly across an output window."""
    if not tokens or end <= start:
        return []
    weights = [max(1, len(token)) for token in tokens]
    total_weight = sum(weights)
    duration = end - start
    mapped: list[MappedWord] = []
    elapsed = 0
    for index, (token, weight) in enumerate(zip(tokens, weights, strict=True)):
        word_start = start + duration * elapsed / total_weight
        elapsed += weight
        word_end = (
            end if index == len(tokens) - 1 else start + duration * elapsed / total_weight
        )
        mapped.append(
            MappedWord(text=token, start=word_start, end=max(word_end, word_start + 0.04))
        )
    return mapped


def build_cues_for_reel(
    *,
    reel_segments: list[TimelineSegment],
    transcript_segments: list[SourceSegment],
    fallback_texts: list[str | None],
    options: SubtitleOptions,
    caption_windows: list[tuple[float, float] | None] | None = None,
) -> CueBuildResult:
    """Remap transcript material onto the final reel timeline and split into cues.

    When a cut has a saved ``fallback_texts`` caption, that text is always packed
    onto the cut (preview and export burn-in). Otherwise live Whisper word
    clocks in the source window drive the subtitle.
    """
    timeline = build_output_timeline(reel_segments)
    if not timeline.placements:
        return CueBuildResult(cues=[], granularity_used=options.granularity, total_duration=0.0)

    template = get_template(options.style)
    mapped_words = _collect_mapped_words(
        timeline.placements,
        transcript_segments,
        fallback_texts,
    )
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

    cues = _suppress_overlapping_cues(cues)
    if caption_windows:
        cues = remap_cues_to_caption_windows(cues, timeline.placements, caption_windows)

    return CueBuildResult(
        cues=cues,
        granularity_used=granularity,
        total_duration=timeline.total_duration,
    )


def remap_cues_to_caption_windows(
    cues: list[SubtitleCue],
    placements: list[SegmentPlacement],
    windows: list[tuple[float, float] | None],
) -> list[SubtitleCue]:
    """Move/scale cues from the video clip onto an independent caption window."""
    if not cues or not any(window is not None for window in windows):
        return cues
    remapped: list[SubtitleCue] = []
    for cue in cues:
        placed = False
        for placement, window in zip(placements, windows, strict=False):
            if window is None:
                continue
            src0 = placement.output_start
            src1 = src0 + placement.content_duration
            mid = (cue.start + cue.end) / 2
            if mid < src0 - 0.02 or mid > src1 + 0.02:
                continue
            dst0, dst1 = window
            span = max(src1 - src0, 0.01)
            scale = max(0.0, dst1 - dst0) / span
            start = dst0 + (cue.start - src0) * scale
            end = dst0 + (cue.end - src0) * scale
            remapped.append(
                SubtitleCue(
                    start=max(dst0, start),
                    end=min(dst1, max(end, start + 0.05)),
                    text=cue.text,
                    words=cue.words,
                    highlight=cue.highlight,
                )
            )
            placed = True
            break
        if not placed:
            remapped.append(cue)
    return remapped


def _suppress_overlapping_cues(cues: list[SubtitleCue]) -> list[SubtitleCue]:
    """Prefer the outgoing (earlier) cue when crossfades stack captions.

    Crossfade placements overlap on the output clock; without this filter both
    segments emit Dialogue events for the same window and text doubles up.
    """
    if len(cues) < 2:
        return cues
    ordered = sorted(cues, key=lambda c: (c.start, c.end))
    result: list[SubtitleCue] = []
    for cue in ordered:
        if not result:
            result.append(cue)
            continue
        prev = result[-1]
        if cue.start + 1e-3 < prev.end:
            # Trim incoming cue to start after the outgoing one ends.
            new_start = prev.end
            if new_start + 0.04 >= cue.end:
                continue
            trimmed_words = tuple(w for w in cue.words if w.end > new_start)
            result.append(
                SubtitleCue(
                    start=new_start,
                    end=cue.end,
                    text=cue.text,
                    words=trimmed_words,
                    highlight=cue.highlight,
                )
            )
        else:
            result.append(cue)
    return result


def _collect_mapped_words(
    placements: list[SegmentPlacement],
    transcript_segments: list[SourceSegment],
    fallback_texts: list[str | None],
) -> list[MappedWord]:
    mapped: list[MappedWord] = []
    for index, placement in enumerate(placements):
        fallback = fallback_texts[index] if index < len(fallback_texts) else None
        mapped.extend(
            _mapped_words_for_placement(placement, transcript_segments, fallback)
        )
    mapped.sort(key=lambda w: (w.start, w.end))
    return _suppress_overlapping_words(mapped)


def _mapped_words_for_placement(
    placement: SegmentPlacement,
    transcript_segments: list[SourceSegment],
    fallback: str | None,
) -> list[MappedWord]:
    overlapping = [
        segment
        for segment in transcript_segments
        if segment.end > placement.source_start and segment.start < placement.source_end
    ]
    mapped: list[MappedWord] = []
    for segment in overlapping:
        for word in segment.words:
            text = sanitize_caption_text(word.text)
            if not text:
                continue
            mapped_interval = map_source_interval(placement, word.start, word.end)
            if mapped_interval is None:
                continue
            out_start, out_end = mapped_interval
            mapped.append(MappedWord(text=text, start=out_start, end=out_end))

    fallback_tokens = _caption_tokens(fallback or "")
    output_start = placement.output_start
    output_end = placement.output_start + placement.content_duration

    # No per-cut caption → live word clocks in this window.
    if not fallback_tokens:
        return mapped
    # Saved fragment subtitle is authoritative for preview AND export burn-in.
    # Always pack the saved text onto this cut so edits cannot be overridden by
    # leftover Whisper word clocks.
    return _synthesize_mapped_words(fallback_tokens, output_start, output_end)


def _suppress_overlapping_words(words: list[MappedWord]) -> list[MappedWord]:
    """Drop incoming words that land inside an earlier (outgoing) word's span."""
    if len(words) < 2:
        return words
    result: list[MappedWord] = []
    for word in words:
        if result and word.start + 1e-3 < result[-1].end:
            continue
        result.append(word)
    return result


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
        display = _case(sanitize_caption_text(raw), options.uppercase)
        cues.extend(
            _cues_from_caption_blocks(
                display,
                start=start,
                end=max(end, start + 0.05),
                max_lines=max_lines,
                max_chars=max_chars,
            )
        )
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
    for index, placement in enumerate(placements):
        fallback = fallback_texts[index] if index < len(fallback_texts) else None
        mapped = _mapped_words_for_placement(placement, transcript_segments, fallback)
        window_start = placement.output_start
        window_end = placement.output_start + placement.content_duration
        if mapped:
            raw = sanitize_caption_text(" ".join(word.text for word in mapped))
            if raw:
                cues.extend(
                    _cues_from_caption_blocks(
                        _case(raw, options.uppercase),
                        start=window_start,
                        end=max(window_end, window_start + 0.05),
                        max_lines=max_lines,
                        max_chars=max_chars,
                    )
                )
            continue

        raw_fallback = sanitize_caption_text(fallback or "")
        if raw_fallback:
            cues.extend(
                _cues_from_caption_blocks(
                    _case(raw_fallback, options.uppercase),
                    start=window_start,
                    end=max(window_end, window_start + 0.05),
                    max_lines=max_lines,
                    max_chars=max_chars,
                )
            )
            continue

        overlapping = [
            seg
            for seg in transcript_segments
            if seg.end > placement.source_start and seg.start < placement.source_end
        ]
        for seg in overlapping:
            mapped_interval = map_source_interval(placement, seg.start, seg.end)
            if mapped_interval is None:
                continue
            raw = sanitize_caption_text(seg.text)
            if not raw:
                continue
            out_start, out_end = mapped_interval
            cues.extend(
                _cues_from_caption_blocks(
                    _case(raw, options.uppercase),
                    start=out_start,
                    end=max(out_end, out_start + 0.05),
                    max_lines=max_lines,
                    max_chars=max_chars,
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


def pack_words_into_lines(words: list[str], max_chars: int) -> list[str]:
    """Pack tokens into visual lines. Never splits a token mid-word."""
    limit = max(1, max_chars)
    lines: list[str] = []
    current = ""
    for word in words:
        if not word:
            continue
        if not current:
            # A single overlong word still occupies its own line intact.
            current = word
            continue
        candidate = f"{current} {word}"
        if len(candidate) <= limit:
            current = candidate
            continue
        lines.append(current)
        current = word
    if current:
        lines.append(current)
    return lines


def split_caption_blocks(text: str, *, max_lines: int, max_chars: int) -> list[str]:
    """Split a caption into ASS cue bodies (``\\N`` line breaks).

    Long captions become several blocks of at most ``max_lines`` each so nothing
    is truncated with an ellipsis mid-word.
    """
    cleaned = sanitize_caption_text(text)
    words = [token for token in _WORD_SPLIT.split(cleaned) if token]
    if not words:
        return []
    lines = pack_words_into_lines(words, max_chars)
    line_limit = max(1, max_lines)
    blocks: list[str] = []
    for index in range(0, len(lines), line_limit):
        chunk = lines[index : index + line_limit]
        if chunk:
            blocks.append("\\N".join(chunk))
    return blocks


def wrap_lines(text: str, *, max_lines: int, max_chars: int) -> str:
    """Wrap on whitespace without cutting words.

    Prefer ``split_caption_blocks`` when the caller can emit multiple cues; this
    helper returns only the first block for simple call sites.
    """
    blocks = split_caption_blocks(text, max_lines=max_lines, max_chars=max_chars)
    return blocks[0] if blocks else ""


def _cues_from_caption_blocks(
    text: str,
    *,
    start: float,
    end: float,
    max_lines: int,
    max_chars: int,
) -> list[SubtitleCue]:
    """Turn a caption into one or more timed cues that never truncate words."""
    blocks = split_caption_blocks(text, max_lines=max_lines, max_chars=max_chars)
    if not blocks:
        return []
    span = max(0.05, end - start)
    if len(blocks) == 1:
        return [SubtitleCue(start=start, end=start + span, text=blocks[0])]

    weights = [max(1, len(block.replace("\\N", " "))) for block in blocks]
    total_weight = sum(weights)
    cues: list[SubtitleCue] = []
    elapsed = 0.0
    for index, (block, weight) in enumerate(zip(blocks, weights, strict=True)):
        cue_start = start + span * elapsed / total_weight
        elapsed += weight
        cue_end = (
            start + span
            if index == len(blocks) - 1
            else start + span * elapsed / total_weight
        )
        cues.append(
            SubtitleCue(
                start=cue_start,
                end=max(cue_end, cue_start + 0.05),
                text=block,
            )
        )
    return cues


def _case(text: str, uppercase: bool) -> str:
    return text.upper() if uppercase else text
