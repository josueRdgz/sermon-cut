"""Shared types for optional vertical subject tracking / reframing."""

from __future__ import annotations

from dataclasses import dataclass
from enum import StrEnum


class FramingMode(StrEnum):
    """How the source is fitted onto the vertical (or other) canvas."""

    auto_track = "auto_track"
    center_crop = "center_crop"
    blurred_background = "blurred_background"
    manual = "manual"


@dataclass(frozen=True)
class BoundingBox:
    """Axis-aligned box in pixel coordinates of a source frame."""

    x: float
    y: float
    width: float
    height: float
    confidence: float = 1.0

    @property
    def cx(self) -> float:
        return self.x + self.width / 2.0

    @property
    def cy(self) -> float:
        return self.y + self.height / 2.0

    def clamp(self, frame_w: float, frame_h: float) -> BoundingBox:
        w = max(1.0, min(self.width, frame_w))
        h = max(1.0, min(self.height, frame_h))
        x = min(max(0.0, self.x), max(0.0, frame_w - w))
        y = min(max(0.0, self.y), max(0.0, frame_h - h))
        return BoundingBox(x=x, y=y, width=w, height=h, confidence=self.confidence)


@dataclass(frozen=True)
class SubjectSample:
    """One tracker observation at an absolute source timestamp."""

    time: float
    box: BoundingBox | None
    stable: bool = True


@dataclass(frozen=True)
class NormalizedPoint:
    """Subject center in normalized source coordinates (0–1)."""

    time: float
    x: float
    y: float
    confidence: float = 1.0
    stable: bool = True


@dataclass(frozen=True)
class CropKeyframe:
    """Crop top-left on the *scaled-to-cover* frame (pixels), segment-relative time."""

    t: float
    x: float
    y: float


@dataclass(frozen=True)
class SegmentCropPlan:
    """Per-segment framing instructions for the FFmpeg graph."""

    mode: FramingMode
    # When mode is auto_track / manual with motion: keyframes after scale-to-cover.
    keyframes: tuple[CropKeyframe, ...] = ()
    # Static pixel offsets when a single crop is enough.
    static_x: float | None = None
    static_y: float | None = None
    unstable: bool = False
    # Absolute source times this plan covers (for debugging / cache).
    source_start: float = 0.0
    source_end: float = 0.0
