"""Interpolation, temporal smoothing and motion limits for virtual camera paths.

Pure functions — no I/O, no OpenCV — so they are easy to unit-test.
"""

from __future__ import annotations

from dataclasses import dataclass

from app.services.tracking.types import NormalizedPoint


@dataclass(frozen=True)
class MotionLimits:
    """Caps on how fast the virtual crop may chase the subject."""

    max_velocity: float = 0.35  # normalized units / second
    max_acceleration: float = 0.8  # normalized units / second^2
    smooth_alpha: float = 0.28  # EMA blend toward target (0 = frozen, 1 = raw)


def interpolate_points(
    samples: list[NormalizedPoint],
    *,
    times: list[float],
) -> list[NormalizedPoint]:
    """Linearly interpolate subject centers onto the requested timeline.

    Gaps where both neighbours are missing yield a center fallback (0.5, 0.45)
    so the crop stays in a natural talking-head region rather than jumping to a
    corner.
    """
    if not times:
        return []
    usable = [s for s in samples if s.confidence > 0 and s.stable]
    if not usable:
        return [
            NormalizedPoint(time=t, x=0.5, y=0.45, confidence=0.0, stable=False)
            for t in times
        ]

    ordered = sorted(usable, key=lambda s: s.time)
    out: list[NormalizedPoint] = []
    for t in times:
        if t <= ordered[0].time:
            first = ordered[0]
            out.append(
                NormalizedPoint(
                    time=t, x=first.x, y=first.y, confidence=first.confidence * 0.9
                )
            )
            continue
        if t >= ordered[-1].time:
            last = ordered[-1]
            out.append(
                NormalizedPoint(
                    time=t, x=last.x, y=last.y, confidence=last.confidence * 0.9
                )
            )
            continue
        # Find surrounding samples.
        right_idx = next(i for i, s in enumerate(ordered) if s.time >= t)
        left = ordered[right_idx - 1]
        right = ordered[right_idx]
        span = max(1e-6, right.time - left.time)
        u = (t - left.time) / span
        out.append(
            NormalizedPoint(
                time=t,
                x=left.x + (right.x - left.x) * u,
                y=left.y + (right.y - left.y) * u,
                confidence=min(left.confidence, right.confidence),
                stable=left.stable and right.stable,
            )
        )
    return out


def smooth_points(
    points: list[NormalizedPoint],
    *,
    limits: MotionLimits | None = None,
) -> list[NormalizedPoint]:
    """EMA smooth + clamp velocity / acceleration in normalized space."""
    if not points:
        return []
    limits = limits or MotionLimits()
    alpha = min(1.0, max(0.0, limits.smooth_alpha))

    smoothed: list[NormalizedPoint] = []
    prev_x = points[0].x
    prev_y = points[0].y
    prev_vx = 0.0
    prev_vy = 0.0
    prev_t = points[0].time

    for index, point in enumerate(points):
        if index == 0:
            smoothed.append(point)
            continue
        dt = max(1e-3, point.time - prev_t)
        # EMA toward the interpolated observation.
        target_x = prev_x + (point.x - prev_x) * alpha
        target_y = prev_y + (point.y - prev_y) * alpha

        desired_vx = (target_x - prev_x) / dt
        desired_vy = (target_y - prev_y) / dt

        # Acceleration clamp.
        ax = (desired_vx - prev_vx) / dt
        ay = (desired_vy - prev_vy) / dt
        ax = _clamp(ax, -limits.max_acceleration, limits.max_acceleration)
        ay = _clamp(ay, -limits.max_acceleration, limits.max_acceleration)
        vx = prev_vx + ax * dt
        vy = prev_vy + ay * dt
        vx = _clamp(vx, -limits.max_velocity, limits.max_velocity)
        vy = _clamp(vy, -limits.max_velocity, limits.max_velocity)

        x = _clamp(prev_x + vx * dt, 0.0, 1.0)
        y = _clamp(prev_y + vy * dt, 0.0, 1.0)

        smoothed.append(
            NormalizedPoint(
                time=point.time,
                x=x,
                y=y,
                confidence=point.confidence,
                stable=point.stable,
            )
        )
        prev_x, prev_y = x, y
        prev_vx, prev_vy = vx, vy
        prev_t = point.time
    return smoothed


def apply_safe_zone_bias(
    points: list[NormalizedPoint],
    *,
    top_safe: float = 0.08,
    bottom_safe: float = 0.18,
) -> list[NormalizedPoint]:
    """Bias the subject toward the clear middle band (room for subtitles).

    ``bottom_safe`` / ``top_safe`` are fractions of the frame reserved so the
    face is not parked under burned-in captions or platform chrome.
    """
    usable_top = top_safe
    usable_bottom = 1.0 - bottom_safe
    mid = (usable_top + usable_bottom) / 2.0
    out: list[NormalizedPoint] = []
    for point in points:
        # Soft pull of Y toward the usable mid band without fighting X.
        pulled_y = point.y * 0.72 + mid * 0.28
        pulled_y = _clamp(pulled_y, usable_top + 0.05, usable_bottom - 0.05)
        out.append(
            NormalizedPoint(
                time=point.time,
                x=_clamp(point.x, 0.05, 0.95),
                y=pulled_y,
                confidence=point.confidence,
                stable=point.stable,
            )
        )
    return out


def stability_ratio(samples: list[NormalizedPoint], *, min_confidence: float = 0.35) -> float:
    """Fraction of samples that look usable — used to degrade to blurred mode."""
    if not samples:
        return 0.0
    good = sum(1 for s in samples if s.stable and s.confidence >= min_confidence)
    return good / len(samples)


def _clamp(value: float, low: float, high: float) -> float:
    return max(low, min(high, value))
