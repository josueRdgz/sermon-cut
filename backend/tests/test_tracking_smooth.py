"""Unit tests for tracking interpolation, smoothing and crop expressions."""

from __future__ import annotations

from app.services.tracking.crop_ffmpeg import build_crop_filter, build_piecewise_expr
from app.services.tracking.geometry import (
    ScaleCoverGeometry,
    center_crop_xy,
    subject_to_crop_xy,
)
from app.services.tracking.smooth import (
    MotionLimits,
    apply_safe_zone_bias,
    interpolate_points,
    smooth_points,
    stability_ratio,
)
from app.services.tracking.types import CropKeyframe, NormalizedPoint


def test_interpolate_between_samples() -> None:
    samples = [
        NormalizedPoint(time=0.0, x=0.2, y=0.3, confidence=1.0),
        NormalizedPoint(time=2.0, x=0.8, y=0.5, confidence=1.0),
    ]
    out = interpolate_points(samples, times=[0.0, 1.0, 2.0])
    assert len(out) == 3
    assert out[1].x == 0.5
    assert out[1].y == 0.4


def test_smooth_limits_velocity() -> None:
    # Huge jump that should be slowed by max_velocity.
    points = [
        NormalizedPoint(time=0.0, x=0.1, y=0.4),
        NormalizedPoint(time=0.2, x=0.9, y=0.4),
        NormalizedPoint(time=0.4, x=0.9, y=0.4),
    ]
    smoothed = smooth_points(
        points, limits=MotionLimits(max_velocity=0.5, max_acceleration=5.0, smooth_alpha=1.0)
    )
    # After 0.2s at max 0.5 units/s, x can move at most ~0.1 from 0.1.
    assert smoothed[1].x < 0.35
    assert smoothed[1].x > points[0].x


def test_safe_zone_bias_keeps_subject_out_of_subtitle_band() -> None:
    points = [NormalizedPoint(time=0.0, x=0.5, y=0.92)]
    biased = apply_safe_zone_bias(points, top_safe=0.08, bottom_safe=0.18)
    assert biased[0].y < 0.85


def test_stability_ratio() -> None:
    samples = [
        NormalizedPoint(time=0.0, x=0.5, y=0.4, confidence=0.8, stable=True),
        NormalizedPoint(time=0.5, x=0.5, y=0.4, confidence=0.0, stable=False),
        NormalizedPoint(time=1.0, x=0.5, y=0.4, confidence=0.9, stable=True),
    ]
    assert stability_ratio(samples) == 2 / 3


def test_geometry_center_and_subject_mapping() -> None:
    geo = ScaleCoverGeometry.compute(
        source_w=1920, source_h=1080, canvas_w=1080, canvas_h=1920
    )
    # Cover height: scale = 1920/1080, scaled_w = 1920 * scale > 1080.
    assert geo.scaled_h == 1920
    assert geo.scaled_w > 1080
    cx, cy = center_crop_xy(geo)
    assert cy == 0.0
    assert abs(cx - geo.max_x / 2) < 1e-6
    x, y = subject_to_crop_xy(NormalizedPoint(time=0, x=0.5, y=0.5), geo)
    assert 0 <= x <= geo.max_x
    assert 0 <= y <= geo.max_y


def test_piecewise_crop_expression_and_filter() -> None:
    keys = [
        CropKeyframe(t=0.0, x=10.0, y=20.0),
        CropKeyframe(t=1.0, x=30.0, y=40.0),
    ]
    expr = build_piecewise_expr(keys, axis="x")
    assert "if(lt(t" in expr
    assert "30" in expr
    filt = build_crop_filter(width=1080, height=1920, keys=keys)
    assert filt.startswith("crop=1080:1920:")
    static = build_crop_filter(width=1080, height=1920, keys=[], static_x=12, static_y=34)
    assert static == "crop=1080:1920:12:34"
