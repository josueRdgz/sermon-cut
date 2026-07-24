"""API for optional vertical subject tracking / reframing."""

from __future__ import annotations

from pathlib import Path
from uuid import UUID

from fastapi import APIRouter, Depends, Query
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

from app.core.exceptions import NotFoundError, ValidationAppError
from app.db.session import get_db
from app.schemas.tracking import (
    FramingModeUpdate,
    FramingPreviewResponse,
    FramingStatusResponse,
    ManualCropUpdate,
    TrackingComputeRequest,
    TrackingReport,
)
from app.services.tracking import cache as tracking_cache
from app.services.tracking import service as tracking_service
from app.services.tracking.tracker import mediapipe_status

router = APIRouter(tags=["framing"])


def _safe_basename(name: str) -> str:
    base = Path(name).name
    if not base or base != name or ".." in name:
        raise ValidationAppError("Invalid preview filename.", code="preview_invalid")
    return base


@router.get("/projects/{project_id}/reels/{reel_id}/framing", response_model=FramingStatusResponse)
def get_framing_status(
    project_id: UUID,
    reel_id: UUID,
    db: Session = Depends(get_db),
) -> FramingStatusResponse:
    return tracking_service.status(db, project_id, reel_id)


@router.put("/projects/{project_id}/reels/{reel_id}/framing", response_model=FramingStatusResponse)
def set_framing_mode(
    project_id: UUID,
    reel_id: UUID,
    payload: FramingModeUpdate,
    db: Session = Depends(get_db),
) -> FramingStatusResponse:
    return tracking_service.set_framing_mode(db, project_id, reel_id, payload.framing_mode)


@router.post(
    "/projects/{project_id}/reels/{reel_id}/framing/track",
    response_model=TrackingReport,
)
def compute_subject_tracking(
    project_id: UUID,
    reel_id: UUID,
    payload: TrackingComputeRequest = TrackingComputeRequest(),
    db: Session = Depends(get_db),
) -> TrackingReport:
    """Sample frames sparsely, track the preacher, cache crop keyframes.

    Does not render the final video with OpenCV — only analysis stills.
    """
    return tracking_service.compute_tracking(db, project_id, reel_id, payload)


@router.delete(
    "/projects/{project_id}/reels/{reel_id}/framing/track",
    response_model=FramingStatusResponse,
)
def clear_subject_tracking(
    project_id: UUID,
    reel_id: UUID,
    db: Session = Depends(get_db),
) -> FramingStatusResponse:
    return tracking_service.clear_tracking(db, project_id, reel_id)


@router.put(
    "/projects/{project_id}/reels/{reel_id}/segments/{segment_id}/manual-crop",
    response_model=FramingStatusResponse,
)
def set_manual_crop(
    project_id: UUID,
    reel_id: UUID,
    segment_id: UUID,
    payload: ManualCropUpdate,
    db: Session = Depends(get_db),
) -> FramingStatusResponse:
    return tracking_service.update_manual_crop(
        db, project_id, reel_id, segment_id, payload
    )


@router.get(
    "/projects/{project_id}/reels/{reel_id}/framing/preview",
    response_model=FramingPreviewResponse,
)
def framing_preview(
    project_id: UUID,
    reel_id: UUID,
    source_time: float = Query(..., ge=0.0),
    segment_id: UUID | None = None,
    db: Session = Depends(get_db),
) -> FramingPreviewResponse:
    return tracking_service.preview_frame(
        db,
        project_id,
        reel_id,
        source_time=source_time,
        segment_uuid=segment_id,
    )


@router.get("/projects/{project_id}/reels/{reel_id}/framing/preview-image")
def framing_preview_image(
    project_id: UUID,
    reel_id: UUID,
    filename: str = Query(..., min_length=1, max_length=200),
) -> FileResponse:
    """Serve a cached still used by the framing preview overlay."""
    path = tracking_cache.preview_dir(project_id, reel_id) / _safe_basename(filename)
    if not path.is_file():
        raise NotFoundError("Preview image not found.", code="preview_missing")
    return FileResponse(path, media_type="image/jpeg")


@router.get("/framing/mediapipe")
def mediapipe_compat() -> dict:
    return mediapipe_status()
