"""Endpoints to start, poll, cancel and play back reel renders."""

from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

from app.core.exceptions import NotFoundError
from app.db.session import get_db
from app.schemas.render_job import (
    RenderJobListResponse,
    RenderJobResponse,
    RenderStartRequest,
)
from app.services.render.manager import RenderManager, get_render_manager

router = APIRouter(tags=["renders"])


@router.post(
    "/projects/{project_id}/reels/{reel_id}/render",
    response_model=RenderJobResponse,
    status_code=202,
)
def start_render(
    project_id: UUID,
    reel_id: UUID,
    payload: RenderStartRequest,
    db: Session = Depends(get_db),
    manager: RenderManager = Depends(get_render_manager),
) -> RenderJobResponse:
    """Render the reel to MP4 (H.264 + AAC).

    Burns ASS subtitles when enabled and always appends the mandatory end card.
    """
    job = manager.start(
        db,
        project_id,
        reel_id,
        aspect_ratio=payload.aspect_ratio.value if payload.aspect_ratio else None,
        layout=payload.layout.value,
        normalize_loudness=payload.normalize_loudness,
        crf=payload.crf,
        burn_subtitles=payload.burn_subtitles,
    )
    return RenderJobResponse.model_validate(job)


@router.get(
    "/projects/{project_id}/reels/{reel_id}/render",
    response_model=RenderJobResponse,
)
def get_latest_render(
    project_id: UUID,  # noqa: ARG001 — scopes the route to a project
    reel_id: UUID,
    db: Session = Depends(get_db),
    manager: RenderManager = Depends(get_render_manager),
) -> RenderJobResponse:
    """Return the most recent render job for the reel (for polling)."""
    job = manager.get_latest_for_reel(db, reel_id)
    if job is None:
        raise NotFoundError("No render job found.", code="render_job_not_found")
    return RenderJobResponse.model_validate(job)


@router.get(
    "/projects/{project_id}/reels/{reel_id}/renders",
    response_model=RenderJobListResponse,
)
def list_renders(
    project_id: UUID,  # noqa: ARG001 — scopes the route to a project
    reel_id: UUID,
    db: Session = Depends(get_db),
    manager: RenderManager = Depends(get_render_manager),
) -> RenderJobListResponse:
    jobs = manager.list_for_reel(db, reel_id)
    items = [RenderJobResponse.model_validate(job) for job in jobs]
    return RenderJobListResponse(items=items, total=len(items))


@router.get("/render-jobs/{job_id}", response_model=RenderJobResponse)
def get_render_job(
    job_id: UUID,
    db: Session = Depends(get_db),
    manager: RenderManager = Depends(get_render_manager),
) -> RenderJobResponse:
    job = manager.get(db, job_id)
    return RenderJobResponse.model_validate(job)


@router.post("/render-jobs/{job_id}/cancel", response_model=RenderJobResponse)
def cancel_render_job(
    job_id: UUID,
    db: Session = Depends(get_db),
    manager: RenderManager = Depends(get_render_manager),
) -> RenderJobResponse:
    job = manager.cancel(db, job_id)
    return RenderJobResponse.model_validate(job)


@router.get("/render-jobs/{job_id}/output")
def get_render_output(
    job_id: UUID,
    download: bool = False,
    db: Session = Depends(get_db),
    manager: RenderManager = Depends(get_render_manager),
) -> FileResponse:
    """Stream the rendered MP4 (supports HTTP Range for the HTML5 player)."""
    job = manager.get(db, job_id)
    path = manager.output_path(job)
    return FileResponse(
        path,
        media_type="video/mp4",
        filename=job.output_filename,
        content_disposition_type="attachment" if download else "inline",
    )
