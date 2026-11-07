"""Volume envelopes for clips and background music."""

from __future__ import annotations

from pathlib import Path

from app.services.audio.volume_envelope import ffmpeg_volume_filter, interpolate_gain, parse_keyframes
from app.services.render.args import RenderSegmentSpec, build_render_command


def test_parse_defaults_to_unity_gain() -> None:
    assert parse_keyframes(None) == [{"t_ms": 0.0, "gain": 1.0}]


def test_interpolate_gain_between_points() -> None:
    points = [{"t_ms": 0.0, "gain": 0.0}, {"t_ms": 1000.0, "gain": 1.0}]
    assert interpolate_gain(points, 500) == 0.5


def test_constant_unity_has_no_filter() -> None:
    assert ffmpeg_volume_filter([{"t_ms": 0, "gain": 1}], 4.0) is None


def test_envelope_filter_uses_frame_eval() -> None:
    filt = ffmpeg_volume_filter(
        [{"t_ms": 0, "gain": 0.2}, {"t_ms": 2000, "gain": 1.0}],
        4.0,
    )
    assert filt is not None
    assert "volume=eval=frame" in filt


def test_render_command_embeds_clip_envelope(tmp_path: Path) -> None:
    plan = build_render_command(
        ffmpeg="ffmpeg",
        source=tmp_path / "src.mp4",
        segments=[
            RenderSegmentSpec(
                0.0,
                4.0,
                volume_keyframes=((0.0, 0.2), (1500.0, 1.0)),
            )
        ],
        aspect_ratio="9:16",
        layout="center_crop",
        output_path=tmp_path / "out.mp4",
        has_audio=True,
    )
    assert "volume=eval=frame" in plan.filter_complex
