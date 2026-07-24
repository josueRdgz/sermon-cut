"""Tests for remapping source windows onto the assembled subtitle timeline."""

from __future__ import annotations

from pathlib import Path

import pytest
from app.services.render.args import RenderSegmentSpec, build_render_command
from app.services.subtitles.ass import ass_timestamp, render_ass_document
from app.services.subtitles.cues import (
    SourceSegment,
    SourceWord,
    SubtitleCue,
    build_cues_for_reel,
    sanitize_caption_text,
)
from app.services.subtitles.fonts import resolve_font
from app.services.subtitles.templates import (
    SubtitleGranularity,
    SubtitleOptions,
    options_from_reel,
)
from app.services.subtitles.timeline import (
    TimelineSegment,
    build_output_timeline,
    map_source_interval,
)


def test_hard_cut_places_second_segment_after_first() -> None:
    # A = 20s, B = 30s → B must start at output second 20.
    timeline = build_output_timeline(
        [
            TimelineSegment(100.0, 120.0),
            TimelineSegment(400.0, 430.0),
        ]
    )
    assert timeline.placements[0].output_start == pytest.approx(0.0)
    assert timeline.placements[1].output_start == pytest.approx(20.0)
    assert timeline.total_duration == pytest.approx(50.0)


def test_crossfade_shortens_total_and_overlaps_starts() -> None:
    timeline = build_output_timeline(
        [
            TimelineSegment(0.0, 10.0, "short_crossfade", 500),
            TimelineSegment(40.0, 50.0),
        ]
    )
    assert timeline.placements[1].output_start == pytest.approx(9.5)
    assert timeline.total_duration == pytest.approx(19.5)


def test_map_source_interval_clips_to_window() -> None:
    timeline = build_output_timeline(
        [TimelineSegment(10.0, 20.0), TimelineSegment(50.0, 60.0)]
    )
    b = timeline.placements[1]
    mapped = map_source_interval(b, 49.0, 51.5)
    assert mapped is not None
    # First window is 10s long, so B starts at output 10.
    assert mapped[0] == pytest.approx(10.0)
    assert mapped[1] == pytest.approx(11.5)
    assert map_source_interval(b, 5.0, 9.0) is None


def test_cues_use_output_clock_not_source_times() -> None:
    reel = [
        TimelineSegment(100.0, 110.0),
        TimelineSegment(200.0, 210.0),
    ]
    transcript = [
        SourceSegment(
            text="hola mundo",
            start=100.0,
            end=110.0,
            words=[
                SourceWord("hola", 101.0, 102.0),
                SourceWord("mundo", 103.0, 104.0),
            ],
        ),
        SourceSegment(
            text="amén",
            start=200.0,
            end=210.0,
            words=[SourceWord("amén", 205.0, 206.0)],
        ),
    ]
    result = build_cues_for_reel(
        reel_segments=reel,
        transcript_segments=transcript,
        fallback_texts=[None, None],
        options=SubtitleOptions(
            style="reformed_sober",
            granularity=SubtitleGranularity.word,
            max_words=1,
        ),
    )
    starts = [cue.start for cue in result.cues]
    # Source 205 → output 15 (10 + 5). Never keep the original 205.
    assert any(abs(s - 15.0) < 0.01 for s in starts)
    assert all(s < 30 for s in starts)
    assert all(s != pytest.approx(205.0) for s in starts)


def test_deleted_word_does_not_appear() -> None:
    reel = [TimelineSegment(0.0, 10.0)]
    transcript = [
        SourceSegment(
            text="palabra limpia",
            start=0.0,
            end=10.0,
            words=[
                SourceWord("palabra", 1.0, 2.0),
                SourceWord("limpia", 2.0, 3.0),
            ],
        )
    ]
    result = build_cues_for_reel(
        reel_segments=reel,
        transcript_segments=transcript,
        fallback_texts=["palabra basura limpia"],
        options=SubtitleOptions(
            style="reformed_sober",
            granularity=SubtitleGranularity.word,
            max_words=10,
        ),
    )
    joined = " ".join(cue.text for cue in result.cues).lower()
    assert "basura" not in joined
    assert "palabra" in joined
    assert "limpia" in joined


def test_degrades_to_segment_without_word_timestamps() -> None:
    reel = [TimelineSegment(0.0, 5.0), TimelineSegment(20.0, 25.0)]
    transcript = [
        SourceSegment(text="primera parte", start=0.0, end=5.0, words=[]),
        SourceSegment(text="segunda parte", start=20.0, end=25.0, words=[]),
    ]
    result = build_cues_for_reel(
        reel_segments=reel,
        transcript_segments=transcript,
        fallback_texts=[None, None],
        options=SubtitleOptions(
            style="modern_highlight",
            granularity=SubtitleGranularity.auto,
        ),
    )
    assert result.granularity_used == SubtitleGranularity.segment
    assert result.cues[0].start == pytest.approx(0.0)
    assert result.cues[1].start == pytest.approx(5.0)


def test_emoji_stripped_from_sober_styles() -> None:
    assert "🙏" not in sanitize_caption_text("Gracia 🙏 Dios")
    assert sanitize_caption_text("Gracia 🙏 Dios") == "Gracia Dios"


def test_ass_document_contains_remapped_times(tmp_path: Path) -> None:
    options = options_from_reel(style="clear_reading")
    font = resolve_font("Helvetica Neue", tmp_path / "fonts")
    doc = render_ass_document(
        cues=[SubtitleCue(start=20.0, end=22.5, text="segunda")],
        options=options,
        font=font,
        play_res_x=1080,
        play_res_y=1920,
    )
    assert "PlayResX: 1080" in doc
    assert ass_timestamp(20.0) in doc
    assert "Dialogue:" in doc
    assert ",3," in doc  # opaque box BorderStyle


def test_render_command_burns_ass_filter(tmp_path: Path) -> None:
    ass = tmp_path / "subs.ass"
    ass.write_text("[Script Info]\n", encoding="utf-8")
    fonts = tmp_path / "fonts"
    fonts.mkdir()
    plan = build_render_command(
        ffmpeg="ffmpeg",
        source=tmp_path / "src.mp4",
        segments=[RenderSegmentSpec(0.0, 2.0), RenderSegmentSpec(5.0, 7.0)],
        aspect_ratio="9:16",
        layout="center_crop",
        output_path=tmp_path / "out.mp4",
        has_audio=True,
        ass_path=ass,
        fonts_dir=fonts,
        normalize_loudness=False,
    )
    assert "ass=" in plan.filter_complex
    assert "fontsdir=" in plan.filter_complex
    assert "[vout]" in plan.filter_complex
    assert plan.args[plan.args.index("-map") + 1] == "[vout]"


def test_timeline_matches_render_expected_duration() -> None:
    specs = [
        RenderSegmentSpec(0.0, 10.0, "short_crossfade", 400),
        RenderSegmentSpec(30.0, 40.0),
    ]
    plan = build_render_command(
        ffmpeg="ffmpeg",
        source=Path("/tmp/x.mp4"),
        segments=specs,
        aspect_ratio="9:16",
        layout="center_crop",
        output_path=Path("/tmp/o.mp4"),
        has_audio=True,
        normalize_loudness=False,
    )
    timeline = build_output_timeline(
        [
            TimelineSegment(s.start, s.end, s.transition_type, s.transition_duration_ms)
            for s in specs
        ]
    )
    assert timeline.total_duration == pytest.approx(plan.expected_duration_seconds)


def test_karaoke_encodes_gaps_between_words() -> None:
    from app.services.subtitles.ass import format_dialogue_text
    from app.services.subtitles.cues import MappedWord
    from app.services.subtitles.templates import get_template

    options = SubtitleOptions(style="modern_highlight", granularity=SubtitleGranularity.word)
    template = get_template(options.style)
    cue = SubtitleCue(
        start=0.0,
        end=3.0,
        text="hola mundo",
        words=(
            MappedWord("hola", 0.5, 1.0),
            MappedWord("mundo", 2.0, 2.5),
        ),
        highlight=True,
    )
    text = format_dialogue_text(cue, template, options)
    # Lead-in 0.5s → \k50; word; gap 1.0s → \k100; word
    assert r"{\k50}" in text
    assert r"{\k100}" in text or r"{\k99}" in text or r"{\k101}" in text


def test_crossfade_does_not_stack_duplicate_segment_cues() -> None:
    reel = [
        TimelineSegment(0.0, 10.0, "short_crossfade", 500),
        TimelineSegment(40.0, 50.0),
    ]
    transcript = [
        SourceSegment(text="saliente", start=0.0, end=10.0, words=[]),
        SourceSegment(text="entrante", start=40.0, end=50.0, words=[]),
    ]
    result = build_cues_for_reel(
        reel_segments=reel,
        transcript_segments=transcript,
        fallback_texts=[None, None],
        options=SubtitleOptions(
            style="clear_reading",
            granularity=SubtitleGranularity.segment,
        ),
    )
    # Overlap window ~9.5–10.0 must not show both captions at once.
    for left, right in zip(result.cues, result.cues[1:], strict=False):
        assert left.end <= right.start + 1e-3
