"""Orchestrate subtitle generation for a reel render."""

from __future__ import annotations

from pathlib import Path

from app.models.reel import Reel
from app.models.transcript import Transcript
from app.services.subtitles.ass import render_ass_document, write_ass_file
from app.services.subtitles.cues import (
    CueBuildResult,
    SourceSegment,
    SourceWord,
    build_cues_for_reel,
)
from app.services.subtitles.fonts import ResolvedFont, resolve_font
from app.services.subtitles.templates import SubtitleOptions, get_template, options_from_reel
from app.services.subtitles.timeline import TimelineSegment


def options_for_reel(reel: Reel) -> SubtitleOptions:
    def _val(value: object | None) -> str | None:
        if value is None:
            return None
        return value.value if hasattr(value, "value") else str(value)

    return options_from_reel(
        style=_val(reel.subtitle_style) or "reformed_sober",
        enabled=bool(getattr(reel, "subtitle_enabled", True)),
        granularity=_val(getattr(reel, "subtitle_granularity", None)),
        font_size=getattr(reel, "subtitle_font_size", None),
        position=_val(getattr(reel, "subtitle_position", None)),
        uppercase=getattr(reel, "subtitle_uppercase", None),
        max_words=getattr(reel, "subtitle_max_words", None),
        opacity=getattr(reel, "subtitle_opacity", None),
        margin_bottom=getattr(reel, "subtitle_margin_bottom", None),
        bible_reference=getattr(reel, "subtitle_bible_reference", None),
    )


def transcript_to_source_segments(transcript: Transcript | None) -> list[SourceSegment]:
    if transcript is None:
        return []
    segments: list[SourceSegment] = []
    for seg in sorted(transcript.segments, key=lambda s: s.order):
        if seg.start_seconds is None or seg.end_seconds is None:
            continue
        words: list[SourceWord] = []
        for word in sorted(seg.words, key=lambda w: w.order):
            if word.start_seconds is None or word.end_seconds is None:
                continue
            text = (word.text or "").strip()
            if not text:
                continue
            words.append(
                SourceWord(text=text, start=word.start_seconds, end=word.end_seconds)
            )
        segments.append(
            SourceSegment(
                text=(seg.text or "").strip(),
                start=seg.start_seconds,
                end=seg.end_seconds,
                words=words,
            )
        )
    return segments


def build_subtitle_artifacts(
    *,
    reel: Reel,
    transcript: Transcript | None,
    output_width: int,
    output_height: int,
    ass_path: Path,
    fonts_dir: Path,
    options: SubtitleOptions | None = None,
) -> tuple[Path, ResolvedFont, CueBuildResult] | None:
    """Generate an ASS file + staged fonts for burning. ``None`` if disabled/empty."""
    opts = options or options_for_reel(reel)
    if not opts.enabled:
        return None

    ordered = sorted(reel.segments, key=lambda s: s.order)
    timeline_segments = [
        TimelineSegment(
            source_start=item.source_start_seconds,
            source_end=item.source_end_seconds,
            transition_type=item.transition_type.value,
            transition_duration_ms=item.transition_duration_ms,
        )
        for item in ordered
    ]
    # Per-cut captions saved in the Reel editor — strip empties to None.
    fallback_texts = [
        (item.transcript_text.strip() if item.transcript_text and item.transcript_text.strip() else None)
        for item in ordered
    ]
    source_segments = transcript_to_source_segments(transcript)

    result = build_cues_for_reel(
        reel_segments=timeline_segments,
        transcript_segments=source_segments,
        fallback_texts=fallback_texts,
        options=opts,
    )
    if not result.cues:
        return None

    template = get_template(opts.style)
    font = resolve_font(template.font_name, fonts_dir)
    document = render_ass_document(
        cues=result.cues,
        options=opts,
        font=font,
        play_res_x=output_width,
        play_res_y=output_height,
    )
    write_ass_file(ass_path, document)
    return ass_path, font, result
