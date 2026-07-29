"""Unit tests for the FFmpeg argument builder and progress parser."""

from __future__ import annotations

from pathlib import Path

import pytest
from app.services.render.args import (
    CANVAS_SIZES,
    LAYOUT_BLURRED_BACKGROUND,
    LAYOUT_CENTER_CROP,
    RenderSegmentSpec,
    build_render_command,
    canvas_for,
    format_command_for_log,
    normalize_fps,
)
from app.services.render.progress import ProgressAccumulator, parse_progress_line

SOURCE = Path("/tmp/source video.mp4")
OUTPUT = Path("/tmp/out.mp4")


def _build(**overrides: object):
    kwargs: dict[str, object] = {
        "ffmpeg": "ffmpeg",
        "source": SOURCE,
        "segments": [
            RenderSegmentSpec(10.2, 10.42),
            RenderSegmentSpec(11.05, 11.29),
        ],
        "aspect_ratio": "9:16",
        "layout": LAYOUT_CENTER_CROP,
        "output_path": OUTPUT,
        "has_audio": True,
    }
    kwargs.update(overrides)
    return build_render_command(**kwargs)  # type: ignore[arg-type]


# --------------------------------------------------------------------------- #
# Canvas + fps
# --------------------------------------------------------------------------- #
def test_canvas_sizes() -> None:
    assert canvas_for("9:16") == (1080, 1920)
    assert canvas_for("1:1") == (1080, 1080)
    assert canvas_for("16:9") == (1920, 1080)
    assert set(CANVAS_SIZES) == {"9:16", "1:1", "16:9"}


def test_unsupported_aspect_ratio() -> None:
    with pytest.raises(ValueError):
        canvas_for("4:3")


def test_normalize_fps_handles_missing_and_extremes() -> None:
    # Variable frame rate sources often probe as None or absurd values.
    assert normalize_fps(None) == 30.0
    assert normalize_fps(0) == 30.0
    assert normalize_fps(29.97) == 29.97
    assert normalize_fps(1000) == 60.0
    assert normalize_fps(2) == 12.0


# --------------------------------------------------------------------------- #
# Argument list shape / safety
# --------------------------------------------------------------------------- #
def test_no_shell_metacharacter_escaping_needed() -> None:
    plan = _build()
    # Paths with spaces are passed as single argv entries, not quoted strings.
    assert str(SOURCE) in plan.args
    assert plan.args[-1] == str(OUTPUT)
    assert not any(arg.startswith("'") for arg in plan.args)


def test_one_input_per_segment_with_accurate_seek() -> None:
    plan = _build()
    assert plan.args.count("-i") == 2
    assert plan.args.count("-accurate_seek") == 2
    # Accurate cuts: seek before -i, bounded by -t, and always re-encoded.
    assert "-ss" in plan.args
    assert "-t" in plan.args
    assert "libx264" in plan.args
    assert "-c" not in plan.args  # never a bare -c copy


def test_output_is_h264_aac_mp4() -> None:
    plan = _build()
    assert "libx264" in plan.args
    assert "aac" in plan.args
    assert "yuv420p" in plan.args
    assert "+faststart" in plan.args
    assert "48000" in plan.args


def test_progress_pipe_requested() -> None:
    plan = _build()
    index = plan.args.index("-progress")
    assert plan.args[index + 1] == "pipe:1"
    assert "-nostats" in plan.args


def test_center_crop_normalizes_every_segment() -> None:
    plan = _build()
    graph = plan.filter_complex
    assert graph.count("scale=1080:1920:force_original_aspect_ratio=increase") == 2
    assert graph.count("crop=1080:1920") == 2
    assert graph.count("fps=30") == 2
    assert graph.count("settb=AVTB") == 2
    assert graph.count("format=yuv420p") == 2
    assert graph.count("setsar=1") == 2
    assert plan.width == 1080
    assert plan.height == 1920


def test_blurred_background_fills_canvas_and_centers_source() -> None:
    plan = _build(layout=LAYOUT_BLURRED_BACKGROUND)
    graph = plan.filter_complex
    # Blurred copy covers the canvas...
    assert "force_original_aspect_ratio=increase" in graph
    assert "gblur=sigma=20" in graph
    # ...and the untouched frame is contained and centred on top.
    assert "force_original_aspect_ratio=decrease" in graph
    assert "overlay=(W-w)/2:(H-h)/2" in graph


def test_audio_normalized_to_stereo_48k_with_boundary_fades() -> None:
    plan = _build()
    graph = plan.filter_complex
    assert graph.count("channel_layouts=stereo") == 2  # mono sources are upmixed
    assert graph.count("aresample=48000") == 2
    assert graph.count("afade=t=in") == 2
    assert graph.count("afade=t=out") == 2
    assert graph.count("d=0.003") == 4


def test_positive_audio_offset_uses_earlier_independent_audio_inputs() -> None:
    plan = _build(audio_offset_ms=250)
    assert plan.args.count("-i") == 4
    seek_values = [
        plan.args[index + 1] for index, value in enumerate(plan.args) if value == "-ss"
    ]
    assert seek_values == ["10.2", "11.05", "9.95", "10.8"]
    assert "[2:a]" in plan.filter_complex
    assert "[3:a]" in plan.filter_complex


def test_negative_audio_offset_advances_audio_and_start_boundary_delays_silence() -> None:
    advanced = _build(audio_offset_ms=-250)
    seek_values = [
        advanced.args[index + 1]
        for index, value in enumerate(advanced.args)
        if value == "-ss"
    ]
    assert seek_values[-2:] == ["10.45", "11.3"]

    near_start = _build(
        segments=[RenderSegmentSpec(0.1, 2.1)],
        audio_offset_ms=500,
    )
    assert "adelay=400:all=1" in near_start.filter_complex
    assert "apad=whole_dur=2" in near_start.filter_complex
    assert "atrim=0:2" in near_start.filter_complex


def test_silence_generated_when_source_has_no_audio() -> None:
    plan = _build(has_audio=False)
    assert plan.args.count("anullsrc=channel_layout=stereo:sample_rate=48000") == 2
    assert plan.args.count("lavfi") == 2
    # Silent inputs come after the video inputs, so their stream indices follow.
    assert "[2:a]" in plan.filter_complex
    assert "[3:a]" in plan.filter_complex


def test_loudness_normalization_optional() -> None:
    assert "loudnorm" in _build().filter_complex
    assert "loudnorm" not in _build(normalize_loudness=False).filter_complex


# --------------------------------------------------------------------------- #
# Joining / transitions
# --------------------------------------------------------------------------- #
def test_hard_cuts_use_concat_and_sum_durations() -> None:
    plan = _build()
    assert "concat=n=2:v=1:a=1" in plan.filter_complex
    assert "xfade" not in plan.filter_complex
    assert plan.expected_duration_seconds == pytest.approx(0.22 + 0.24)


def test_single_segment_needs_no_join() -> None:
    plan = _build(segments=[RenderSegmentSpec(5.0, 9.0)])
    assert "concat" not in plan.filter_complex
    assert "xfade" not in plan.filter_complex
    assert plan.expected_duration_seconds == pytest.approx(4.0)


def test_crossfade_keeps_audio_and_video_in_sync() -> None:
    plan = _build(
        segments=[
            RenderSegmentSpec(0.0, 10.0, "short_crossfade", 500),
            RenderSegmentSpec(40.0, 50.0),
        ]
    )
    graph = plan.filter_complex
    assert "xfade=transition=fade:duration=0.5:offset=9.5" in graph
    # Matching audio crossfade duration keeps both streams the same length.
    assert "acrossfade=d=0.5" in graph
    assert plan.expected_duration_seconds == pytest.approx(19.5)


def test_dip_to_black_uses_fadeblack() -> None:
    plan = _build(
        segments=[
            RenderSegmentSpec(0.0, 5.0, "dip_to_black", 400),
            RenderSegmentSpec(20.0, 25.0),
        ]
    )
    assert "xfade=transition=fadeblack:duration=0.4" in plan.filter_complex
    assert "acrossfade=d=0.4" in plan.filter_complex


def test_crossfade_longer_than_segment_falls_back_safely() -> None:
    # A 5 s crossfade cannot fit a 0.5 s segment: clamp, never emit a negative offset.
    plan = _build(
        segments=[
            RenderSegmentSpec(0.0, 0.5, "short_crossfade", 5000),
            RenderSegmentSpec(10.0, 10.5),
        ]
    )
    assert "offset=-" not in plan.filter_complex
    assert plan.expected_duration_seconds > 0


def test_mixed_transitions_chain_in_order() -> None:
    plan = _build(
        segments=[
            RenderSegmentSpec(0.0, 5.0, "hard_cut", 0),
            RenderSegmentSpec(20.0, 25.0, "short_crossfade", 300),
            RenderSegmentSpec(40.0, 45.0),
        ]
    )
    graph = plan.filter_complex
    assert "concat=n=2:v=1:a=1[cv1][ca1]" in graph
    assert "[cv1][v2]xfade" in graph
    assert plan.expected_duration_seconds == pytest.approx(14.7)


# --------------------------------------------------------------------------- #
# Validation + logging
# --------------------------------------------------------------------------- #
def test_empty_segments_rejected() -> None:
    with pytest.raises(ValueError):
        _build(segments=[])


def test_zero_length_segment_rejected() -> None:
    with pytest.raises(ValueError):
        _build(segments=[RenderSegmentSpec(5.0, 5.0)])


def test_unknown_layout_rejected() -> None:
    with pytest.raises(ValueError):
        _build(layout="fancy_zoom")


def test_command_log_is_shell_quoted() -> None:
    plan = _build()
    logged = format_command_for_log(plan.args)
    # The path contains a space, so it must appear quoted in the debug string.
    assert "'/tmp/source video.mp4'" in logged
    assert logged.startswith("ffmpeg ")


# --------------------------------------------------------------------------- #
# -progress parsing
# --------------------------------------------------------------------------- #
def test_parse_progress_line() -> None:
    assert parse_progress_line("frame=120") == ("frame", "120")
    assert parse_progress_line("  speed=1.5x  ") == ("speed", "1.5x")
    assert parse_progress_line("garbage") is None
    assert parse_progress_line("") is None


def test_accumulator_emits_on_block_boundary() -> None:
    accumulator = ProgressAccumulator()
    assert accumulator.feed("frame=48") is None
    assert accumulator.feed("out_time_us=2000000") is None
    assert accumulator.feed("speed=2.5x") is None

    update = accumulator.feed("progress=continue")
    assert update is not None
    assert update.out_time_seconds == pytest.approx(2.0)
    assert update.frame == 48
    assert update.speed == pytest.approx(2.5)
    assert update.finished is False


def test_accumulator_detects_end() -> None:
    accumulator = ProgressAccumulator()
    accumulator.feed("out_time_us=5000000")
    update = accumulator.feed("progress=end")
    assert update is not None
    assert update.finished is True
    assert update.out_time_seconds == pytest.approx(5.0)


def test_accumulator_falls_back_to_out_time_string() -> None:
    accumulator = ProgressAccumulator()
    accumulator.feed("out_time=00:00:03.500000")
    update = accumulator.feed("progress=continue")
    assert update is not None
    assert update.out_time_seconds == pytest.approx(3.5)


def test_accumulator_tolerates_na_values() -> None:
    accumulator = ProgressAccumulator()
    accumulator.feed("out_time_us=N/A")
    accumulator.feed("speed=N/A")
    update = accumulator.feed("progress=continue")
    assert update is not None
    assert update.out_time_seconds is None
    assert update.speed is None
