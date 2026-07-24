"""Map normalized subject centers onto scale-to-cover crop coordinates."""

from __future__ import annotations

from dataclasses import dataclass

from app.services.tracking.types import CropKeyframe, NormalizedPoint


@dataclass(frozen=True)
class ScaleCoverGeometry:
    """Geometry after ``scale=W:H:force_original_aspect_ratio=increase``."""

    source_w: int
    source_h: int
    canvas_w: int
    canvas_h: int
    scaled_w: float
    scaled_h: float

    @classmethod
    def compute(
        cls, *, source_w: int, source_h: int, canvas_w: int, canvas_h: int
    ) -> ScaleCoverGeometry:
        if source_w <= 0 or source_h <= 0:
            raise ValueError("Source dimensions must be positive.")
        scale = max(canvas_w / source_w, canvas_h / source_h)
        return cls(
            source_w=source_w,
            source_h=source_h,
            canvas_w=canvas_w,
            canvas_h=canvas_h,
            scaled_w=source_w * scale,
            scaled_h=source_h * scale,
        )

    @property
    def max_x(self) -> float:
        return max(0.0, self.scaled_w - self.canvas_w)

    @property
    def max_y(self) -> float:
        return max(0.0, self.scaled_h - self.canvas_h)


def center_crop_xy(geometry: ScaleCoverGeometry) -> tuple[float, float]:
    return geometry.max_x / 2.0, geometry.max_y / 2.0


def subject_to_crop_xy(
    point: NormalizedPoint,
    geometry: ScaleCoverGeometry,
) -> tuple[float, float]:
    """Place the subject near the canvas center within the scaled frame."""
    subj_x = point.x * geometry.scaled_w
    subj_y = point.y * geometry.scaled_h
    x = subj_x - geometry.canvas_w / 2.0
    y = subj_y - geometry.canvas_h / 2.0
    x = min(max(0.0, x), geometry.max_x)
    y = min(max(0.0, y), geometry.max_y)
    return x, y


def points_to_keyframes(
    points: list[NormalizedPoint],
    *,
    geometry: ScaleCoverGeometry,
    segment_start: float,
) -> list[CropKeyframe]:
    """Convert absolute-time normalized points into segment-relative crop keys."""
    keys: list[CropKeyframe] = []
    for point in points:
        x, y = subject_to_crop_xy(point, geometry)
        keys.append(
            CropKeyframe(t=max(0.0, point.time - segment_start), x=x, y=y)
        )
    return keys


def decimate_keyframes(keys: list[CropKeyframe], *, max_points: int = 24) -> list[CropKeyframe]:
    """Keep expression size bounded for FFmpeg filtergraphs."""
    if len(keys) <= max_points:
        return keys
    if max_points <= 2:
        return [keys[0], keys[-1]]
    step = (len(keys) - 1) / (max_points - 1)
    indices = sorted({int(round(i * step)) for i in range(max_points)})
    indices[0] = 0
    indices[-1] = len(keys) - 1
    return [keys[i] for i in indices]
