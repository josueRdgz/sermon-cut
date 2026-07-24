"""Endpoints to start, poll, cancel and play back reel renders."""

from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

from app.core.exceptions import NotFoundError, ValidationAppError
from app.core.paths import project_renders_dir
from app.db.session import get_db
from app.schemas.render_job import (
    RenderJobListResponse,
    RenderJobResponse,
    RenderStartRequest,
    RevealResponse,
)
from app.services.export_profiles.reveal import reveal_in_file_manager
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
    """Render the reel to MP4 (H.264 + AAC) using an export profile.

    Burns ASS subtitles when enabled and always appends the mandatory end card.
    Never auto-publishes — output stays local.
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
        profile_id=payload.profile_id,
        quality=payload.quality,
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


@router.get("/render-jobs/{job_id}/report")
def get_render_report(
    job_id: UUID,
    db: Session = Depends(get_db),
    manager: RenderManager = Depends(get_render_manager),
) -> FileResponse:
    """Download the JSON render report written next to the MP4."""
    job = manager.get(db, job_id)
    if not job.report_filename:
        raise NotFoundError("Render report not found.", code="render_report_missing")
    directory = project_renders_dir(job.project_id).resolve()
    candidate = (directory / job.report_filename).resolve()
    if not candidate.is_relative_to(directory) or not candidate.is_file():
        raise NotFoundError("Render report file is missing.", code="render_report_missing")
    return FileResponse(
        candidate,
        media_type="application/json",
        filename=job.report_filename,
        content_disposition_type="attachment",
    )


@router.post("/render-jobs/{job_id}/reveal", response_model=RevealResponse)
def reveal_render_output(
    job_id: UUID,
    db: Session = Depends(get_db),
    manager: RenderManager = Depends(get_render_manager),
) -> RevealResponse:
    """Open the folder containing the MP4 in Finder / Explorer / file manager."""
    from app.models.render_job import RenderJobStatus

    job = manager.get(db, job_id)
    if job.status != RenderJobStatus.completed:
        raise ValidationAppError(
            "Solo se puede revelar un render completado.",
            code="render_not_ready",
        )
    path = manager.output_path(job)
    result = reveal_in_file_manager(path)
    return RevealResponse(**result)
