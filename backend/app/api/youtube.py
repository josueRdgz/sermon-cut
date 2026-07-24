"""Endpoints for the optional YouTube import (preview, import, poll, cancel).

Local file upload remains the primary path (see ``api/projects.py``). These
routes only add an opt-in way to fetch a single public/unlisted video.
"""

from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.core.exceptions import NotFoundError
from app.db.session import get_db
from app.schemas.youtube import (
    YouTubeImportJobResponse,
    YouTubeImportRequest,
    YouTubePreviewRequest,
    YouTubePreviewResponse,
)
from app.services.youtube.manager import (
    YouTubeImportManager,
    fetch_preview,
    get_youtube_import_manager,
)

router = APIRouter(tags=["youtube"])


@router.post("/youtube/preview", response_model=YouTubePreviewResponse)
def preview_youtube(payload: YouTubePreviewRequest) -> YouTubePreviewResponse:
    """Validate a URL and return a preview via yt-dlp metadata extraction."""
    preview = fetch_preview(payload.url)
    return YouTubePreviewResponse(
        video_id=preview.video_id,
        title=preview.title,
        channel=preview.channel,
        duration_seconds=preview.duration_seconds,
        thumbnail_url=preview.thumbnail_url,
        resolution_label=preview.resolution_label,
        upload_date=preview.upload_date,
    )


@router.post(
    "/projects/{project_id}/youtube-import",
    response_model=YouTubeImportJobResponse,
    status_code=202,
)
def start_youtube_import(
    project_id: UUID,
    payload: YouTubeImportRequest,
    db: Session = Depends(get_db),
    manager: YouTubeImportManager = Depends(get_youtube_import_manager),
) -> YouTubeImportJobResponse:
    """Create and enqueue a YouTube import for a project."""
    job = manager.start(
        db,
        project_id,
        url=payload.url,
        quality=payload.quality.value,
    )
    return YouTubeImportJobResponse.model_validate(job)


@router.get(
    "/projects/{project_id}/youtube-import",
    response_model=YouTubeImportJobResponse,
)
def get_latest_youtube_import(
    project_id: UUID,
    db: Session = Depends(get_db),
    manager: YouTubeImportManager = Depends(get_youtube_import_manager),
) -> YouTubeImportJobResponse:
    """Return the most recent import job for the project (for polling)."""
    job = manager.get_latest_for_project(db, project_id)
    if job is None:
        raise NotFoundError("No import job found.", code="youtube_job_not_found")
    return YouTubeImportJobResponse.model_validate(job)


@router.get(
    "/youtube-import-jobs/{job_id}",
    response_model=YouTubeImportJobResponse,
)
def get_youtube_import_job(
    job_id: UUID,
    db: Session = Depends(get_db),
    manager: YouTubeImportManager = Depends(get_youtube_import_manager),
) -> YouTubeImportJobResponse:
    """Return a single import job by id."""
    job = manager.get(db, job_id)
    return YouTubeImportJobResponse.model_validate(job)


@router.post(
    "/youtube-import-jobs/{job_id}/cancel",
    response_model=YouTubeImportJobResponse,
)
def cancel_youtube_import_job(
    job_id: UUID,
    db: Session = Depends(get_db),
    manager: YouTubeImportManager = Depends(get_youtube_import_manager),
) -> YouTubeImportJobResponse:
    """Request cancellation of a running/queued import job."""
    job = manager.cancel(db, job_id)
    return YouTubeImportJobResponse.model_validate(job)
