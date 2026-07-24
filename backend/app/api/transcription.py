"""Endpoints to start, poll and cancel local transcription jobs."""

from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.core.exceptions import NotFoundError
from app.db.session import get_db
from app.schemas.transcription_job import (
    TranscriptionJobResponse,
    TranscriptionStartRequest,
)
from app.services.whisper.manager import JobManager, get_job_manager

router = APIRouter(tags=["transcription"])


@router.post(
    "/projects/{project_id}/transcription",
    response_model=TranscriptionJobResponse,
    status_code=202,
)
def start_transcription(
    project_id: UUID,
    payload: TranscriptionStartRequest,
    db: Session = Depends(get_db),
    manager: JobManager = Depends(get_job_manager),
) -> TranscriptionJobResponse:
    """Start a local transcription for the project's video."""
    job = manager.start(
        db,
        project_id,
        model_name=payload.model_name.value,
        language_option=payload.language.value,
    )
    return TranscriptionJobResponse.model_validate(job)


@router.get(
    "/projects/{project_id}/transcription",
    response_model=TranscriptionJobResponse,
)
def get_latest_transcription(
    project_id: UUID,
    db: Session = Depends(get_db),
    manager: JobManager = Depends(get_job_manager),
) -> TranscriptionJobResponse:
    """Return the most recent transcription job for the project (for polling)."""
    job = manager.get_latest_for_project(db, project_id)
    if job is None:
        raise NotFoundError("No transcription job found.", code="job_not_found")
    return TranscriptionJobResponse.model_validate(job)


@router.get(
    "/transcription-jobs/{job_id}",
    response_model=TranscriptionJobResponse,
)
def get_transcription_job(
    job_id: UUID,
    db: Session = Depends(get_db),
    manager: JobManager = Depends(get_job_manager),
) -> TranscriptionJobResponse:
    """Return a single transcription job by id."""
    job = manager.get(db, job_id)
    return TranscriptionJobResponse.model_validate(job)


@router.post(
    "/transcription-jobs/{job_id}/cancel",
    response_model=TranscriptionJobResponse,
)
def cancel_transcription_job(
    job_id: UUID,
    db: Session = Depends(get_db),
    manager: JobManager = Depends(get_job_manager),
) -> TranscriptionJobResponse:
    """Request cancellation of a running/queued transcription job."""
    job = manager.cancel(db, job_id)
    return TranscriptionJobResponse.model_validate(job)
