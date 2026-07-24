"""Orchestrate subject tracking: analyze, cache, build crop plans, preview."""

from __future__ import annotations

import logging
from uuid import UUID

from sqlalchemy.orm import Session

from app.core.exceptions import NotFoundError, ValidationAppError
from app.models.reel import ReelSegment
from app.schemas.tracking import (
    FramingPreviewResponse,
    FramingStatusResponse,
    ManualCropUpdate,
    TrackingComputeRequest,
    TrackingReport,
    TrackingSegmentResult,
)
from app.services import projects as projects_service
from app.services import storage
from app.services.ffprobe import probe_video
from app.services.reels import service as reels_service
from app.services.tracking import cache as tracking_cache
from app.services.tracking.geometry import (
    ScaleCoverGeometry,
    center_crop_xy,
    decimate_keyframes,
    points_to_keyframes,
    subject_to_crop_xy,
)
from app.services.tracking.sample import analyze_window, extract_still, sample_times
from app.services.tracking.smooth import (
    MotionLimits,
    apply_safe_zone_bias,
    interpolate_points,
    smooth_points,
    stability_ratio,
)
from app.services.tracking.tracker import mediapipe_status, resolve_tracker
from app.services.tracking.types import (
    FramingMode,
    NormalizedPoint,
    SegmentCropPlan,
)

logger = logging.getLogger(__name__)

# Below this ratio of usable samples, degrade the segment to blurred background.
_STABILITY_THRESHOLD = 0.45
_INTERP_FPS = 8.0


def compute_tracking(
    db: Session,
    project_id: UUID,
    reel_id: UUID,
    options: TrackingComputeRequest | None = None,
    *,
    still_runner=None,
) -> TrackingReport:
    """Run sparse tracking for every Reel segment and persist a cache file."""
    options = options or TrackingComputeRequest()
    project = projects_service.get_project(db, project_id)
    reel = reels_service.get_reel_for_project(db, project_id, reel_id)
    if not project.video_filename:
        raise ValidationAppError("El proyecto no tiene video.", code="video_missing")
    source = storage.resolve_inside_project(project_id, project.video_filename)
    if not source.is_file():
        raise ValidationAppError("Falta el archivo de video.", code="video_missing")

    metadata = probe_video(source)
    source_w = int(getattr(metadata, "width", None) or 1920)
    source_h = int(getattr(metadata, "height", None) or 1080)
    aspect = options.aspect_ratio or reel.aspect_ratio.value
    from app.services.render.args import canvas_for

    canvas_w, canvas_h = canvas_for(aspect)
    geometry = ScaleCoverGeometry.compute(
        source_w=source_w, source_h=source_h, canvas_w=canvas_w, canvas_h=canvas_h
    )

    try:
        tracker = resolve_tracker(options.tracker)
    except RuntimeError as exc:
        raise ValidationAppError(str(exc), code="tracking_unavailable") from exc

    ordered = sorted(reel.segments, key=lambda s: s.order)
    if not ordered:
        raise ValidationAppError("El Reel no tiene fragmentos.", code="reel_empty")

    runner_kwargs = {}
    if still_runner is not None:
        runner_kwargs["runner"] = still_runner

    segment_payloads: list[dict] = []
    results: list[TrackingSegmentResult] = []

    for index, segment in enumerate(ordered, start=1):
        raw_points = analyze_window(
            source,
            start=segment.source_start_seconds,
            end=segment.source_end_seconds,
            tracker=tracker,
            sample_fps=options.sample_fps,
            frame_width=source_w,
            frame_height=source_h,
            **runner_kwargs,
        )
        dense_times = sample_times(
            segment.source_start_seconds,
            segment.source_end_seconds,
            fps=_INTERP_FPS,
        )
        interpolated = interpolate_points(raw_points, times=dense_times)
        smoothed = smooth_points(interpolated, limits=MotionLimits())
        biased = apply_safe_zone_bias(smoothed)
        ratio = stability_ratio(raw_points)
        unstable = ratio < _STABILITY_THRESHOLD
        mode = FramingMode.auto_track
        if unstable:
            mode = FramingMode.blurred_background

        keys = decimate_keyframes(
            points_to_keyframes(
                biased, geometry=geometry, segment_start=segment.source_start_seconds
            )
        )
        segment_payloads.append(
            {
                "segment_id": index,
                "segment_uuid": str(segment.id),
                "source_start": segment.source_start_seconds,
                "source_end": segment.source_end_seconds,
                "stability": ratio,
                "unstable": unstable,
                "mode": mode.value,
                "points": [
                    {
                        "time": p.time,
                        "x": p.x,
                        "y": p.y,
                        "confidence": p.confidence,
                        "stable": p.stable,
                    }
                    for p in biased
                ],
                "keyframes": [{"t": k.t, "x": k.x, "y": k.y} for k in keys],
            }
        )
        results.append(
            TrackingSegmentResult(
                segment_id=index,
                segment_uuid=segment.id,
                stability=ratio,
                unstable=unstable,
                mode=mode,
                sample_count=len(raw_points),
                keyframe_count=len(keys),
            )
        )

    payload = {
        "project_id": str(project_id),
        "reel_id": str(reel_id),
        "tracker": tracker.name,
        "sample_fps": options.sample_fps,
        "aspect_ratio": aspect,
        "source_width": source_w,
        "source_height": source_h,
        "canvas_width": canvas_w,
        "canvas_height": canvas_h,
        "mediapipe": mediapipe_status(),
        "segments": segment_payloads,
    }
    tracking_cache.save_cache(project_id, reel_id, payload)

    # Persist framing mode on the reel when computing auto track.
    reel.framing_mode = FramingMode.auto_track.value
    reels_service._touch(reel)  # noqa: SLF001
    db.commit()

    return TrackingReport(
        reel_id=reel_id,
        tracker=tracker.name,
        cached=True,
        segments=results,
        mediapipe=mediapipe_status(),
        summary=(
            f"Tracking ({tracker.name}): {len(results)} fragmento(s). "
            f"{sum(1 for r in results if r.unstable)} degradado(s) a fondo desenfocado."
        ),
    )


def clear_tracking(db: Session, project_id: UUID, reel_id: UUID) -> FramingStatusResponse:
    reels_service.get_reel_for_project(db, project_id, reel_id)
    removed = tracking_cache.clear_cache(project_id, reel_id)
    return status(db, project_id, reel_id, cleared=removed)


def status(
    db: Session,
    project_id: UUID,
    reel_id: UUID,
    *,
    cleared: bool = False,
) -> FramingStatusResponse:
    reel = reels_service.get_reel_for_project(db, project_id, reel_id)
    cached = tracking_cache.load_cache(project_id, reel_id)
    return FramingStatusResponse(
        reel_id=reel_id,
        framing_mode=FramingMode(reel.framing_mode or FramingMode.center_crop.value),
        has_cache=cached is not None,
        cache_segments=len(cached.get("segments", [])) if cached else 0,
        mediapipe=mediapipe_status(),
        cleared=cleared,
    )


def set_framing_mode(
    db: Session, project_id: UUID, reel_id: UUID, mode: FramingMode
) -> FramingStatusResponse:
    reel = reels_service.get_reel_for_project(db, project_id, reel_id)
    reel.framing_mode = mode.value
    reels_service._touch(reel)  # noqa: SLF001
    db.commit()
    return status(db, project_id, reel_id)


def update_manual_crop(
    db: Session,
    project_id: UUID,
    reel_id: UUID,
    segment_id: UUID,
    payload: ManualCropUpdate,
) -> FramingStatusResponse:
    reel = reels_service.get_reel_for_project(db, project_id, reel_id)
    segment = next((s for s in reel.segments if s.id == segment_id), None)
    if segment is None:
        raise NotFoundError("Fragmento no encontrado.", code="reel_segment_not_found")
    segment.manual_crop_x = payload.x
    segment.manual_crop_y = payload.y
    segment.manual_crop_zoom = payload.zoom
    reel.framing_mode = FramingMode.manual.value
    reels_service._touch(reel)  # noqa: SLF001
    db.commit()
    return status(db, project_id, reel_id)


def build_crop_plans_for_reel(
    db: Session,
    project_id: UUID,
    reel_id: UUID,
    *,
    layout_override: str | None = None,
) -> list[SegmentCropPlan]:
    """Resolve per-segment crop plans for the render graph."""
    project = projects_service.get_project(db, project_id)
    reel = reels_service.get_reel_for_project(db, project_id, reel_id)
    mode = FramingMode(layout_override or reel.framing_mode or FramingMode.center_crop.value)

    metadata_w = project.width or 1920
    metadata_h = project.height or 1080
    from app.services.render.args import canvas_for

    canvas_w, canvas_h = canvas_for(reel.aspect_ratio.value)
    geometry = ScaleCoverGeometry.compute(
        source_w=metadata_w,
        source_h=metadata_h,
        canvas_w=canvas_w,
        canvas_h=canvas_h,
    )
    cached = tracking_cache.load_cache(project_id, reel_id)
    cached_by_uuid = {}
    if cached:
        for item in cached.get("segments", []):
            cached_by_uuid[item.get("segment_uuid")] = item

    plans: list[SegmentCropPlan] = []
    for segment in sorted(reel.segments, key=lambda s: s.order):
        plans.append(
            _plan_for_segment(
                segment,
                mode=mode,
                geometry=geometry,
                cached=cached_by_uuid.get(str(segment.id)),
            )
        )
    return plans


def _plan_for_segment(
    segment: ReelSegment,
    *,
    mode: FramingMode,
    geometry: ScaleCoverGeometry,
    cached: dict | None,
) -> SegmentCropPlan:
    start = segment.source_start_seconds
    end = segment.source_end_seconds

    if mode == FramingMode.blurred_background:
        return SegmentCropPlan(
            mode=mode, source_start=start, source_end=end, unstable=False
        )

    if mode == FramingMode.center_crop:
        cx, cy = center_crop_xy(geometry)
        return SegmentCropPlan(
            mode=mode,
            static_x=cx,
            static_y=cy,
            source_start=start,
            source_end=end,
        )

    if mode == FramingMode.manual:
        x = segment.manual_crop_x if segment.manual_crop_x is not None else 0.5
        y = segment.manual_crop_y if segment.manual_crop_y is not None else 0.45
        point = NormalizedPoint(time=start, x=x, y=y, confidence=1.0)
        # Zoom > 1 pads toward center crop limits (simple: ignore zoom beyond clamp).
        crop_x, crop_y = subject_to_crop_xy(point, geometry)
        return SegmentCropPlan(
            mode=mode,
            static_x=crop_x,
            static_y=crop_y,
            source_start=start,
            source_end=end,
        )

    # auto_track
    if cached and cached.get("unstable"):
        return SegmentCropPlan(
            mode=FramingMode.blurred_background,
            unstable=True,
            source_start=start,
            source_end=end,
        )
    if cached and cached.get("keyframes"):
        from app.services.tracking.types import CropKeyframe

        keys = tuple(
            CropKeyframe(t=float(k["t"]), x=float(k["x"]), y=float(k["y"]))
            for k in cached["keyframes"]
        )
        return SegmentCropPlan(
            mode=FramingMode.auto_track,
            keyframes=keys,
            source_start=start,
            source_end=end,
            unstable=False,
        )
    # No cache yet — safe center fallback.
    cx, cy = center_crop_xy(geometry)
    return SegmentCropPlan(
        mode=FramingMode.center_crop,
        static_x=cx,
        static_y=cy,
        source_start=start,
        source_end=end,
    )


def preview_frame(
    db: Session,
    project_id: UUID,
    reel_id: UUID,
    *,
    source_time: float,
    segment_uuid: UUID | None = None,
) -> FramingPreviewResponse:
    """Return crop metadata (+ optional still path) for the framing overlay."""
    project = projects_service.get_project(db, project_id)
    reel = reels_service.get_reel_for_project(db, project_id, reel_id)
    if not project.video_filename:
        raise ValidationAppError("El proyecto no tiene video.", code="video_missing")
    source = storage.resolve_inside_project(project_id, project.video_filename)

    ordered = sorted(reel.segments, key=lambda s: s.order)
    segment = None
    if segment_uuid is not None:
        segment = next((s for s in ordered if s.id == segment_uuid), None)
    if segment is None:
        segment = next(
            (
                s
                for s in ordered
                if s.source_start_seconds <= source_time <= s.source_end_seconds
            ),
            ordered[0] if ordered else None,
        )
    if segment is None:
        raise ValidationAppError("No hay fragmento para previsualizar.", code="reel_empty")

    plans = build_crop_plans_for_reel(db, project_id, reel_id)
    index = ordered.index(segment)
    plan = plans[index]
    mode = plan.mode

    from app.services.render.args import canvas_for

    canvas_w, canvas_h = canvas_for(reel.aspect_ratio.value)
    geometry = ScaleCoverGeometry.compute(
        source_w=project.width or 1920,
        source_h=project.height or 1080,
        canvas_w=canvas_w,
        canvas_h=canvas_h,
    )

    rel_t = max(0.0, source_time - segment.source_start_seconds)
    if plan.keyframes:
        crop_x, crop_y = _interp_key_xy(plan.keyframes, rel_t)
    elif plan.static_x is not None and plan.static_y is not None:
        crop_x, crop_y = plan.static_x, plan.static_y
    else:
        crop_x, crop_y = center_crop_xy(geometry)

    # Normalized crop rect in scaled space → approximate source-normalized box.
    norm_x = crop_x / max(1.0, geometry.scaled_w)
    norm_y = crop_y / max(1.0, geometry.scaled_h)
    norm_w = canvas_w / max(1.0, geometry.scaled_w)
    norm_h = canvas_h / max(1.0, geometry.scaled_h)

    still_name = None
    try:
        preview_root = tracking_cache.preview_dir(project_id, reel_id)
        still = preview_root / f"t-{source_time:.2f}.jpg"
        if not still.is_file():
            extract_still(source, at_seconds=source_time, output=still)
        still_name = still.name
    except Exception as exc:  # noqa: BLE001
        logger.info("Preview still skipped: %s", exc)

    return FramingPreviewResponse(
        segment_uuid=segment.id,
        source_time=source_time,
        mode=mode,
        crop_x=crop_x,
        crop_y=crop_y,
        canvas_width=canvas_w,
        canvas_height=canvas_h,
        norm_x=norm_x,
        norm_y=norm_y,
        norm_w=norm_w,
        norm_h=norm_h,
        preview_filename=still_name,
        unstable=plan.unstable,
    )


def _interp_key_xy(keys: tuple, t: float) -> tuple[float, float]:
    if not keys:
        return 0.0, 0.0
    if t <= keys[0].t:
        return keys[0].x, keys[0].y
    if t >= keys[-1].t:
        return keys[-1].x, keys[-1].y
    for index in range(1, len(keys)):
        right = keys[index]
        if t <= right.t:
            left = keys[index - 1]
            span = max(1e-6, right.t - left.t)
            u = (t - left.t) / span
            return left.x + (right.x - left.x) * u, left.y + (right.y - left.y) * u
    return keys[-1].x, keys[-1].y
