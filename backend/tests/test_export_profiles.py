"""Unit tests for export profiles: naming, estimates, FFprobe verification."""

from __future__ import annotations

from pathlib import Path

import pytest
from app.core.exceptions import AppError
from app.models.export_profile import ExportPlatform, ExportProfile, ExportQuality, FpsMode
from app.services.export_profiles.estimate import estimate_size
from app.services.export_profiles.naming import build_export_stem, slugify
from app.services.export_profiles.verify import VerifyExpectation, verify_render_output
from app.services.ffprobe import VideoMetadata


def _profile(**overrides: object) -> ExportProfile:
    values: dict[str, object] = {
        "slug": "youtube-short",
        "name": "YouTube Shorts",
        "platform": ExportPlatform.youtube_shorts,
        "width": 1080,
        "height": 1920,
        "aspect_ratio": "9:16",
        "max_duration_seconds": 60,
        "fps_mode": FpsMode.original,
        "safe_margin_x": 0.08,
        "safe_top": 0.10,
        "safe_bottom": 0.16,
        "crf_draft": 28,
        "crf_standard": 23,
        "crf_high": 18,
        "preset_draft": "veryfast",
        "preset_standard": "medium",
        "preset_high": "slow",
        "audio_bitrate_draft_k": 128,
        "audio_bitrate_standard_k": 160,
        "audio_bitrate_high_k": 192,
        "fragmentation_enabled": False,
        "prefer_small_file": False,
        "is_builtin": True,
        "is_active": True,
    }
    values.update(overrides)
    return ExportProfile(**values)  # type: ignore[arg-type]


def test_slugify_and_safe_filename() -> None:
    assert slugify("Título Sermón!") == "titulo-sermon"
    stem = build_export_stem(
        project_title="Título Sermón",
        clip_index=1,
        profile_slug="youtube-short",
    )
    assert stem == "titulo-sermon_clip-01_youtube-short"


def test_estimate_grows_with_quality() -> None:
    profile = _profile()
    draft = estimate_size(
        profile=profile,
        quality=ExportQuality.draft,
        duration_seconds=30,
        fps=30,
    )
    high = estimate_size(
        profile=profile,
        quality=ExportQuality.high,
        duration_seconds=30,
        fps=30,
    )
    assert draft.estimated_bytes < high.estimated_bytes
    assert draft.crf == 28
    assert high.crf == 18


def test_whatsapp_prefer_small_file_reduces_estimate() -> None:
    normal = estimate_size(
        profile=_profile(prefer_small_file=False),
        quality=ExportQuality.standard,
        duration_seconds=20,
        fps=30,
    )
    small = estimate_size(
        profile=_profile(prefer_small_file=True, crf_standard=26),
        quality=ExportQuality.standard,
        duration_seconds=20,
        fps=30,
    )
    assert small.estimated_bytes < normal.estimated_bytes


def test_verify_checks_resolution_duration_audio(tmp_path: Path) -> None:
    path = tmp_path / "out.mp4"
    path.write_bytes(b"\x00" * 128)

    def ok_prober(_path: Path) -> VideoMetadata:
        return VideoMetadata(5.0, 1080, 1920, 30.0, "h264", "aac")

    assert verify_render_output(
        path,
        VerifyExpectation(width=1080, height=1920),
        prober=ok_prober,
    ).ok

    def bad_res(_path: Path) -> VideoMetadata:
        return VideoMetadata(5.0, 720, 1280, 30.0, "h264", "aac")

    bad = verify_render_output(
        path,
        VerifyExpectation(width=1080, height=1920),
        prober=bad_res,
    )
    assert not bad.ok
    assert bad.code == "render_resolution_mismatch"

    def zero_dur(_path: Path) -> VideoMetadata:
        return VideoMetadata(0.0, 1080, 1920, 30.0, "h264", "aac")

    zero = verify_render_output(
        path,
        VerifyExpectation(width=1080, height=1920),
        prober=zero_dur,
    )
    assert not zero.ok
    assert zero.code == "render_zero_duration"

    def no_audio(_path: Path) -> VideoMetadata:
        return VideoMetadata(5.0, 1080, 1920, 30.0, "h264", None)

    missing = verify_render_output(
        path,
        VerifyExpectation(width=1080, height=1920, expect_audio=True),
        prober=no_audio,
    )
    assert not missing.ok
    assert missing.code == "render_missing_audio"

    def boom(_path: Path) -> VideoMetadata:
        raise AppError("corrupt", code="ffprobe_failed", status_code=422)

    corrupt = verify_render_output(
        path,
        VerifyExpectation(width=1080, height=1920),
        prober=boom,
    )
    assert not corrupt.ok
    assert corrupt.code == "render_output_corrupt"
