"""Abstract subject tracker and local OpenCV implementation.

MediaPipe is evaluated optionally: if the package is installed it can be used,
but OpenCV remains the default because it is lighter, works offline without
TFLite wheels, and is enough for a standing preacher in a medium shot.
"""

from __future__ import annotations

import logging
from abc import ABC, abstractmethod
from typing import Any

from app.services.tracking.types import BoundingBox

logger = logging.getLogger(__name__)


class SubjectTracker(ABC):
    """Detect a primary subject (face / person) inside one BGR frame."""

    name: str = "abstract"

    @abstractmethod
    def detect(self, frame_bgr: Any) -> BoundingBox | None:
        """Return the best subject box in pixel coordinates, or ``None``."""


class OpenCVSubjectTracker(SubjectTracker):
    """Local Haar face cascade with HOG full-body fallback.

    Frames are expected as ``numpy`` BGR arrays. The tracker never writes video;
    callers sample frames (typically via FFmpeg stills) and only ask for boxes.
    """

    name = "opencv"

    def __init__(self) -> None:
        try:
            import cv2  # type: ignore[import-not-found]
        except ImportError as exc:  # pragma: no cover - optional dependency
            raise RuntimeError(
                "OpenCV is required for subject tracking. "
                "Install with: pip install -e '.[tracking]'"
            ) from exc
        self._cv2 = cv2
        cascade_path = cv2.data.haarcascades + "haarcascade_frontalface_default.xml"
        self._face = cv2.CascadeClassifier(cascade_path)
        self._hog = cv2.HOGDescriptor()
        self._hog.setSVMDetector(cv2.HOGDescriptor_getDefaultPeopleDetector())

    def detect(self, frame_bgr: Any) -> BoundingBox | None:
        cv2 = self._cv2
        if frame_bgr is None or getattr(frame_bgr, "size", 0) == 0:
            return None
        gray = cv2.cvtColor(frame_bgr, cv2.COLOR_BGR2GRAY)
        gray = cv2.equalizeHist(gray)
        faces = self._face.detectMultiScale(
            gray, scaleFactor=1.1, minNeighbors=5, minSize=(48, 48)
        )
        if len(faces) > 0:
            # Prefer the largest face (usually the preacher).
            x, y, w, h = max(faces, key=lambda box: box[2] * box[3])
            # Expand slightly toward torso so the crop is not face-only.
            expand_y = int(h * 0.85)
            expand_x = int(w * 0.35)
            frame_h, frame_w = frame_bgr.shape[:2]
            return BoundingBox(
                x=float(max(0, x - expand_x)),
                y=float(max(0, y - expand_y * 0.25)),
                width=float(min(frame_w, w + 2 * expand_x)),
                height=float(min(frame_h, h + expand_y)),
                confidence=0.85,
            ).clamp(frame_w, frame_h)

        people, weights = self._hog.detectMultiScale(
            frame_bgr, winStride=(8, 8), padding=(8, 8), scale=1.05
        )
        if len(people) == 0:
            return None
        best_idx = int(max(range(len(people)), key=lambda i: people[i][2] * people[i][3]))
        x, y, w, h = people[best_idx]
        conf = float(weights[best_idx]) if len(weights) > best_idx else 0.5
        frame_h, frame_w = frame_bgr.shape[:2]
        return BoundingBox(
            x=float(x),
            y=float(y),
            width=float(w),
            height=float(h),
            confidence=max(0.35, min(0.95, conf)),
        ).clamp(frame_w, frame_h)


class MediaPipeSubjectTracker(SubjectTracker):
    """Optional MediaPipe face detector.

    Only constructed when ``mediapipe`` is importable. Prefer OpenCV for the
    default sermon workflow; MediaPipe adds large native wheels and is not
    required for MVP quality.
    """

    name = "mediapipe"

    def __init__(self) -> None:
        try:
            import mediapipe as mp  # type: ignore[import-not-found]
        except ImportError as exc:  # pragma: no cover
            raise RuntimeError(
                "MediaPipe is not installed. Use OpenCVSubjectTracker or "
                "pip install mediapipe (optional, heavier)."
            ) from exc
        self._mp = mp
        self._detector = mp.solutions.face_detection.FaceDetection(
            model_selection=1, min_detection_confidence=0.5
        )

    def detect(self, frame_bgr: Any) -> BoundingBox | None:
        import cv2  # type: ignore[import-not-found]

        if frame_bgr is None or getattr(frame_bgr, "size", 0) == 0:
            return None
        rgb = cv2.cvtColor(frame_bgr, cv2.COLOR_BGR2RGB)
        result = self._detector.process(rgb)
        if not result.detections:
            return None
        frame_h, frame_w = frame_bgr.shape[:2]
        best = max(
            result.detections,
            key=lambda d: d.location_data.relative_bounding_box.width
            * d.location_data.relative_bounding_box.height,
        )
        rel = best.location_data.relative_bounding_box
        return BoundingBox(
            x=float(rel.xmin * frame_w),
            y=float(rel.ymin * frame_h),
            width=float(rel.width * frame_w),
            height=float(rel.height * frame_h),
            confidence=float(best.score[0]) if best.score else 0.6,
        ).clamp(frame_w, frame_h)


def resolve_tracker(preferred: str = "opencv") -> SubjectTracker:
    """Pick an available tracker implementation."""
    if preferred == "mediapipe":
        try:
            return MediaPipeSubjectTracker()
        except RuntimeError:
            logger.info("MediaPipe unavailable; falling back to OpenCV")
    return OpenCVSubjectTracker()


def mediapipe_status() -> dict[str, object]:
    """Small compatibility report for docs / health-style endpoints."""
    try:
        import mediapipe as mp  # type: ignore[import-not-found]

        return {
            "available": True,
            "version": getattr(mp, "__version__", "unknown"),
            "recommended": False,
            "reason": (
                "OpenCV is preferred for Sermon Cut: lighter install, no TFLite "
                "wheels, sufficient for a single preacher in medium shot. "
                "MediaPipe is optional if you need denser face landmarks later."
            ),
        }
    except ImportError:
        return {
            "available": False,
            "version": None,
            "recommended": False,
            "reason": (
                "Not installed. Optional only — OpenCV Haar/HOG covers the "
                "default vertical reframing workflow."
            ),
        }
