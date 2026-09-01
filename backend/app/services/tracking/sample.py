"""Sample source frames at a reduced rate without rendering a full OpenCV video."""

from __future__ import annotations

import logging
import shutil
import subprocess
import tempfile
import threading
from collections.abc import Callable
from pathlib import Path

from app.services.tracking.tracker import SubjectTracker
from app.services.tracking.types import BoundingBox, NormalizedPoint, SubjectSample

logger = logging.getLogger(__name__)

FFmpegRunner = Callable[[list[str]], None]

_extract_lock = threading.Lock()
_STILL_TIMEOUT_SECONDS = 20.0


def _default_runner(args: list[str]) -> None:
    try:
        completed = subprocess.run(  # noqa: S603
            args,
            capture_output=True,
            text=True,
            check=False,
            timeout=_STILL_TIMEOUT_SECONDS,
        )
    except subprocess.TimeoutExpired as exc:
        raise RuntimeError("ffmpeg frame extract timed out") from exc
    if completed.returncode != 0:
        raise RuntimeError(completed.stderr[-500:] or "ffmpeg frame extract failed")


def sample_times(start: float, end: float, *, fps: float = 2.0) -> list[float]:
    """Uniform sample timestamps inside ``[start, end)``."""
    if end <= start:
        return []
    step = 1.0 / max(0.25, fps)
    times: list[float] = []
    t = start
    while t < end - 1e-3:
        times.append(round(t, 3))
        t += step
    if not times or times[-1] < end - step * 0.5:
        times.append(round(max(start, end - 0.05), 3))
    return times


def extract_still(
    source: Path,
    *,
    at_seconds: float,
    output: Path,
    ffmpeg: str | None = None,
    runner: FFmpegRunner = _default_runner,
    wait: bool = True,
) -> Path:
    """Grab a single JPEG still — analysis only, never a full export."""
    binary = ffmpeg or shutil.which("ffmpeg")
    if binary is None:
        raise RuntimeError("FFmpeg is required to sample frames for tracking.")
    output.parent.mkdir(parents=True, exist_ok=True)
    args = [
        binary,
        "-hide_banner",
        "-loglevel",
        "error",
        "-ss",
        f"{max(0.0, at_seconds):.3f}",
        "-i",
        str(source),
        "-frames:v",
        "1",
        "-q:v",
        "5",
        "-y",
        str(output),
    ]
    acquired = _extract_lock.acquire(timeout=None if wait else 0.05)
    if not acquired:
        raise RuntimeError("preview still busy")
    try:
        runner(args)
    finally:
        _extract_lock.release()
    return output


def analyze_window(
    source: Path,
    *,
    start: float,
    end: float,
    tracker: SubjectTracker,
    sample_fps: float = 2.0,
    frame_width: int | None = None,
    frame_height: int | None = None,
    ffmpeg: str | None = None,
    runner: FFmpegRunner = _default_runner,
    work_dir: Path | None = None,
) -> list[NormalizedPoint]:
    """Detect the subject on sparse stills and return normalized centers."""
    times = sample_times(start, end, fps=sample_fps)
    if not times:
        return []

    try:
        import cv2  # type: ignore[import-not-found]
    except ImportError as exc:  # pragma: no cover
        raise RuntimeError(
            "OpenCV is required for subject tracking. Install with: pip install -e '.[tracking]'"
        ) from exc

    owns_dir = work_dir is None
    root = Path(tempfile.mkdtemp(prefix="sermon-track-")) if owns_dir else work_dir
    assert root is not None
    samples: list[SubjectSample] = []
    try:
        for index, t in enumerate(times):
            still = root / f"frame-{index:04d}.jpg"
            try:
                extract_still(source, at_seconds=t, output=still, ffmpeg=ffmpeg, runner=runner)
            except RuntimeError:
                samples.append(SubjectSample(time=t, box=None, stable=False))
                continue
            image = cv2.imread(str(still))
            if image is None:
                samples.append(SubjectSample(time=t, box=None, stable=False))
                continue
            box = tracker.detect(image)
            h, w = image.shape[:2]
            if frame_width is None:
                frame_width = w
            if frame_height is None:
                frame_height = h
            samples.append(SubjectSample(time=t, box=box, stable=box is not None))
    finally:
        if owns_dir:
            shutil.rmtree(root, ignore_errors=True)

    width = float(frame_width or 1)
    height = float(frame_height or 1)
    points: list[NormalizedPoint] = []
    for sample in samples:
        if sample.box is None:
            points.append(
                NormalizedPoint(time=sample.time, x=0.5, y=0.45, confidence=0.0, stable=False)
            )
            continue
        box: BoundingBox = sample.box
        points.append(
            NormalizedPoint(
                time=sample.time,
                x=box.cx / width,
                y=box.cy / height,
                confidence=box.confidence,
                stable=sample.stable,
            )
        )
    return points
