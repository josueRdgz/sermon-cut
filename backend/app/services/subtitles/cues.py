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


def _token_key(tokens: list[str]) -> str:
    return " ".join(token.casefold() for token in tokens)


def _is_token_subsequence(short: list[str], long: list[str]) -> bool:
    if not short:
        return True
    iterator = iter(long)
    return all(any(item.casefold() == token.casefold() for item in iterator) for token in short)


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
) -> CueBuildResult:
    """Remap transcript material onto the final reel timeline and split into cues.

    Live word timestamps are preferred when they still match the caption text.
    When the user edits a fragment and the remaining word clocks no longer cover
    that text (or the text was rewritten), the edited ``fallback_texts`` are
    packed onto the cut so the full subtitle remains visible.
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

    return CueBuildResult(
        cues=cues,
        granularity_used=granularity,
        total_duration=timeline.total_duration,
    )


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
    live_tokens: list[str] = []
    for segment in overlapping:
        live_tokens.extend(_caption_tokens(segment.text))
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
    mapped_tokens = [word.text for word in mapped]
    fallback_key = _token_key(fallback_tokens)
    mapped_key = _token_key(mapped_tokens)
    live_key = _token_key(live_tokens)

    if not fallback_tokens:
        return mapped
    if mapped_key == fallback_key:
        return mapped

    # Legacy contamination: every cut stored the full Whisper span as caption.
    if (
        mapped
        and fallback_key == live_key
        and len(fallback_tokens) > len(mapped_tokens)
        and _is_token_subsequence(mapped_tokens, fallback_tokens)
    ):
        return mapped

    # Stale reel caption still lists words the live transcript already deleted.
    if (
        mapped
        and live_key == mapped_key
        and _is_token_subsequence(mapped_tokens, fallback_tokens)
        and fallback_key != live_key
    ):
        return mapped

    # User-edited per-cut caption is authoritative — always honor it.
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
    for index, placement in enumerate(placements):
        fallback = fallback_texts[index] if index < len(fallback_texts) else None
        mapped = _mapped_words_for_placement(placement, transcript_segments, fallback)
        if mapped:
            raw = sanitize_caption_text(" ".join(word.text for word in mapped))
            if raw:
                text = wrap_lines(
                    _case(raw, options.uppercase),
                    max_lines=max_lines,
                    max_chars=max_chars,
                )
                if text:
                    cues.append(
                        SubtitleCue(
                            start=placement.output_start,
                            end=placement.output_start + placement.content_duration,
                            text=text,
                        )
                    )
            continue

        raw_fallback = sanitize_caption_text(fallback or "")
        if raw_fallback:
            text = wrap_lines(
                _case(raw_fallback, options.uppercase),
                max_lines=max_lines,
                max_chars=max_chars,
            )
            if text:
                cues.append(
                    SubtitleCue(
                        start=placement.output_start,
                        end=placement.output_start + placement.content_duration,
                        text=text,
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
            text = wrap_lines(
                _case(raw, options.uppercase),
                max_lines=max_lines,
                max_chars=max_chars,
            )
            out_start, out_end = mapped_interval
            cues.append(
                SubtitleCue(start=out_start, end=max(out_end, out_start + 0.05), text=text)
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
