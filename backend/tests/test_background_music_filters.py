"""Unit tests for background-music FFmpeg filter builders."""

from __future__ import annotations

from pathlib import Path

from app.models.background_music import BackgroundMusicPreset, BackgroundMusicScope
from app.services.background_music.ffmpeg_filters import (
    ALIMITER,
    DUCK_RATIO,
    DUCK_THRESHOLD,
    PRESET_VALUES,
    BackgroundMusicSpec,
    build_background_music_graph,
    build_ducked_mix_filters,
    build_loudnorm_filter,
    build_music_prep_filter,
    volume_to_db,
)
from app.services.render.args import (
    LAYOUT_CENTER_CROP,
    LoudnessSpec,
    RenderSegmentSpec,
    build_render_command,
)


def _spec(**overrides: object) -> BackgroundMusicSpec:
    values: dict[str, object] = {
        "path": Path("/tmp/bed.mp3"),
        "volume": 0.1,
        "start_seconds": 1.5,
        "end_seconds": 40.0,
        "fade_in_seconds": 1.5,
        "fade_out_seconds": 2.0,
        "scope": BackgroundMusicScope.full_reel,
        "ducking": True,
        "target_lufs": -16.0,
        "true_peak_db": -1.5,
        "lra": 11.0,
    }
    values.update(overrides)
    return BackgroundMusicSpec(**values)  # type: ignore[arg-type]


def test_loudnorm_clamps_spoken_word_range() -> None:
    assert build_loudnorm_filter(target_lufs=-16) == "loudnorm=I=-16:TP=-1.5:LRA=11"
    # Hotter than -12 is clamped; quieter than -24 is clamped.
    assert "I=-12" in build_loudnorm_filter(target_lufs=-8)
    assert "I=-24" in build_loudnorm_filter(target_lufs=-30)
    assert "TP=-1.5" in build_loudnorm_filter(true_peak_db=-1.5)


def test_music_prep_includes_trim_fades_volume_and_pad() -> None:
    line = build_music_prep_filter(
        input_label="2:a",
        output_label="bgm_raw",
        volume=0.1,
        start_seconds=1.5,
        end_seconds=40.0,
        fade_in_seconds=1.5,
        fade_out_seconds=2.0,
        timeline_seconds=12.0,
    )
    assert line.startswith("[2:a]atrim=")
    assert "[2:a]," not in line
    assert "atrim=1.5:40" in line
    assert "afade=t=in:st=0:d=1.5" in line
    assert "afade=t=out" in line
    assert "volume=0.1" in line
    assert "apad=whole_dur=12" in line
    assert line.endswith("[bgm_raw]")
    assert "aloop" not in line


def test_ducking_applies_slider_gain_only_once() -> None:
    ducked = build_ducked_mix_filters(
        voice_label="a0",
        music_label="bgm_raw",
        output_label="bgm_mixed",
        ducking=True,
    )
    joined = ";".join(ducked)
    assert "asplit=2" in joined
    assert "sidechaincompress=" in joined
    assert f"threshold={DUCK_THRESHOLD}" in joined
    assert "ratio=3" in joined
    assert "weights=1 1" in joined

    plain = build_ducked_mix_filters(
        voice_label="a0",
        music_label="bgm_raw",
        output_label="bgm_mixed",
        ducking=False,
    )
    assert len(plain) == 1
    assert "sidechaincompress" not in plain[0]
    assert "weights=1 1" in plain[0]


def test_soft_preset_stays_audible_before_moderate_ducking() -> None:
    preset = PRESET_VALUES[BackgroundMusicPreset.very_soft_background]
    assert preset["volume"] == 0.18
    assert DUCK_THRESHOLD == 0.08
    assert DUCK_RATIO == 3.0


def test_background_music_graph_orders_mix_limiter_loudnorm() -> None:
    lines, label = build_background_music_graph(
        voice_label="ca1",
        music_input_index=2,
        spec=_spec(),
        main_duration=20.0,
        normalize_loudness=True,
    )
    text = ";".join(lines)
    assert "[2:a]" in text
    assert "sidechaincompress=" in text
    assert ALIMITER in text
    assert "loudnorm=I=-16:TP=-1.5:LRA=11" in text
    assert label == "bgm_out"
    # Limiter must appear before loudnorm in the chain.
    assert text.index(ALIMITER) < text.index("loudnorm=")


def test_volume_to_db_floor() -> None:
    assert volume_to_db(1.0) == 0.0
    assert -20.1 < volume_to_db(0.1) < -19.9
    assert volume_to_db(0.0) < -100.0


def test_render_command_embeds_full_reel_music_filters() -> None:
    plan = build_render_command(
        ffmpeg="ffmpeg",
        source=Path("/tmp/source.mp4"),
        segments=[RenderSegmentSpec(0.0, 5.0)],
        aspect_ratio="9:16",
        layout=LAYOUT_CENTER_CROP,
        output_path=Path("/tmp/out.mp4"),
        has_audio=True,
        normalize_loudness=True,
        background_music=_spec(path=Path("/tmp/user-bed.ogg")),
        loudness=LoudnessSpec(target_lufs=-18.0),
    )
    assert "-stream_loop" not in plan.args
    assert str(Path("/tmp/user-bed.ogg")) in plan.args
    assert "apad=whole_dur=5" in plan.filter_complex
    assert "sidechaincompress=" in plan.filter_complex
    assert "loudnorm=I=-16" in plan.filter_complex  # from music spec, not LoudnessSpec
    assert ALIMITER in plan.filter_complex


def test_render_command_without_music_uses_configurable_loudnorm() -> None:
    plan = build_render_command(
        ffmpeg="ffmpeg",
        source=Path("/tmp/source.mp4"),
        segments=[RenderSegmentSpec(0.0, 3.0)],
        aspect_ratio="9:16",
        layout=LAYOUT_CENTER_CROP,
        output_path=Path("/tmp/out.mp4"),
        has_audio=True,
        normalize_loudness=True,
        loudness=LoudnessSpec(target_lufs=-18.0, true_peak_db=-1.0),
    )
    assert "sidechaincompress" not in plan.filter_complex
    assert ALIMITER in plan.filter_complex
    assert "loudnorm=I=-18:TP=-1:LRA=11" in plan.filter_complex


def test_end_card_only_music_is_not_mixed_into_main() -> None:
    plan = build_render_command(
        ffmpeg="ffmpeg",
        source=Path("/tmp/source.mp4"),
        segments=[RenderSegmentSpec(0.0, 4.0)],
        aspect_ratio="9:16",
        layout=LAYOUT_CENTER_CROP,
        output_path=Path("/tmp/out.mp4"),
        has_audio=True,
        background_music=_spec(scope=BackgroundMusicScope.end_card_only, ducking=False),
    )
    assert "-stream_loop" not in plan.args
    assert "sidechaincompress" not in plan.filter_complex
