"""OpenCV 4 Haar/HOG tracker must load; OpenCV 5 removed those APIs."""

from __future__ import annotations

import pytest
from app.services.tracking.tracker import OpenCVSubjectTracker, resolve_tracker


def test_opencv_tracker_exposes_haar_and_hog() -> None:
    try:
        import cv2  # type: ignore[import-not-found]
    except ImportError:
        pytest.skip("OpenCV is not installed")
    if not hasattr(cv2, "CascadeClassifier"):
        pytest.fail(
            f"cv2 {getattr(cv2, '__version__', '?')} has no CascadeClassifier. "
            "Install opencv-python-headless>=4.9,<5"
        )
    tracker = resolve_tracker("opencv")
    assert isinstance(tracker, OpenCVSubjectTracker)
    assert not tracker._face.empty()
