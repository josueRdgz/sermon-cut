"""Tests for 0.4.1 overlays, transitions and output-clock helpers."""

from __future__ import annotations

from pathlib import Path

from app.models.reel import TransitionType
from app.services.overlays_render import render_title_card
from app.services.render.args import OverlaySpec, RenderSegmentSpec, build_render_command
from app.services.subtitles.timeline import TimelineSegment, build_output_timeline
from PIL import Image


def test_fade_and_flash_are_xfade_transitions() -> None:
    segments = [
        TimelineSegment(0, 5, "fade", 400),
        TimelineSegment(10, 16, "flash", 300),
        TimelineSegment(20, 24, "hard_cut", 0),
    ]
    timeline = build_output_timeline(segments)
    # Two usable overlaps shrink the sum of durations.
    assert timeline.total_duration < 5 + 6 + 4
    assert timeline.total_duration > 10


def test_build_render_command_maps_flash_and_overlays(tmp_path: Path) -> None:
    source = tmp_path / "source.mp4"
    source.write_bytes(b"\x00" * 64)
    overlay_png = tmp_path / "ov.png"
    Image.new("RGBA", (200, 120), (255, 0, 0, 180)).save(overlay_png)
    out = tmp_path / "out.mp4"

    plan = build_render_command(
        ffmpeg="ffmpeg",
        source=source,
        segments=[
            RenderSegmentSpec(0, 4, transition_type="flash", transition_duration_ms=350),
            RenderSegmentSpec(8, 12, transition_type="hard_cut", transition_duration_ms=0),
        ],
        aspect_ratio="9:16",
        layout="center_crop",
        output_path=out,
        has_audio=True,
        normalize_loudness=False,
        end_card=None,
        overlays=[
            OverlaySpec(
                path=overlay_png,
                start_seconds=1.0,
                duration_seconds=2.0,
                x=0.5,
                y=0.35,
                scale=0.4,
                opacity=0.9,
            )
        ],
    )
    joined = " ".join(plan.args)
    assert "xfade=transition=fadewhite" in plan.filter_complex
    assert "overlay=" in plan.filter_complex
    assert str(overlay_png) in joined


def test_build_render_command_composites_video_broll(tmp_path: Path) -> None:
    source = tmp_path / "source.mp4"
    source.write_bytes(b"\x00" * 64)
    broll = tmp_path / "broll.mp4"
    broll.write_bytes(b"\x00" * 64)
    out = tmp_path / "out.mp4"

    plan = build_render_command(
        ffmpeg="ffmpeg",
        source=source,
        segments=[RenderSegmentSpec(0, 6, transition_type="hard_cut", transition_duration_ms=0)],
        aspect_ratio="9:16",
        layout="center_crop",
        output_path=out,
        has_audio=True,
        normalize_loudness=False,
        end_card=None,
        overlays=[
            OverlaySpec(
                path=broll,
                start_seconds=1.0,
                duration_seconds=2.5,
                x=0.78,
                y=0.22,
                scale=0.38,
                opacity=1.0,
                kind="video",
            )
        ],
    )
    joined = " ".join(plan.args)
    assert str(broll) in joined
    assert "overlay=" in plan.filter_complex
    assert "trim=duration=2.5" in plan.filter_complex
    assert "between(t,1,3.5)" in plan.filter_complex


def test_render_title_card_writes_png(tmp_path: Path) -> None:
    dest = tmp_path / "title.png"
    render_title_card("Juan 3:16", dest, width=640, height=240)
    assert dest.is_file()
    assert dest.stat().st_size > 200


def test_transition_type_enum_includes_fade_flash() -> None:
    assert TransitionType.fade.value == "fade"
    assert TransitionType.flash.value == "flash"
