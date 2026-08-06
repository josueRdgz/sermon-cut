"""Analyze, repair, preview and download project audio."""

from __future__ import annotations

import json
from uuid import UUID

from fastapi import APIRouter, Depends
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

from app.core.exceptions import NotFoundError
from app.db.session import get_db
from app.models.audio_repair import AudioRepairJob
from app.schemas.audio_repair import AudioRepairJobResponse, AudioRepairStartRequest
from app.services import storage
from app.services.audio_repair.manager import AudioRepairManager, get_audio_repair_manager

router = APIRouter(tags=["audio-repair"])


def _response(job: AudioRepairJob) -> AudioRepairJobResponse:
    try:
        issues = json.loads(job.issues_json or "[]")
    except json.JSONDecodeError:
        issues = []
    return AudioRepairJobResponse(
        id=job.id,
        project_id=job.project_id,
        status=job.status.value,
        stage=job.stage,
        progress=job.progress,
        silence_threshold=job.silence_threshold,
        min_dropout_ms=job.min_dropout_ms,
        max_auto_repair_ms=job.max_auto_repair_ms,
        max_review_ms=job.max_review_ms,
        issue_count=job.issue_count,
        repaired_count=job.repaired_count,
        review_count=job.review_count,
        issues=issues,
        has_repaired_audio=bool(job.repaired_audio_filename),
        has_repaired_video=bool(job.repaired_video_filename),
        has_original_audio=storage.resolve_inside_project(
            job.project_id, "original-audio.wav"
        ).is_file()
        if job.status.value == "completed"
        else False,
        error_message=job.error_message,
        created_at=job.created_at,
        updated_at=job.updated_at,
        started_at=job.started_at,
        finished_at=job.finished_at,
    )


@router.post(
    "/projects/{project_id}/audio-repair",
    response_model=AudioRepairJobResponse,
    status_code=202,
)
def start_audio_repair(
    project_id: UUID,
    payload: AudioRepairStartRequest,
    db: Session = Depends(get_db),
    manager: AudioRepairManager = Depends(get_audio_repair_manager),
) -> AudioRepairJobResponse:
    job = manager.start(db, project_id, **payload.model_dump())
    return _response(job)


@router.get("/projects/{project_id}/audio-repair", response_model=AudioRepairJobResponse)
def get_latest_audio_repair(
    project_id: UUID,
    db: Session = Depends(get_db),
    manager: AudioRepairManager = Depends(get_audio_repair_manager),
) -> AudioRepairJobResponse:
    job = manager.get_latest_for_project(db, project_id)
    if job is None:
        raise NotFoundError("No audio repair has been run.", code="audio_repair_not_found")
    return _response(job)


@router.get("/audio-repair-jobs/{job_id}", response_model=AudioRepairJobResponse)
def get_audio_repair_job(
    job_id: UUID,
    db: Session = Depends(get_db),
    manager: AudioRepairManager = Depends(get_audio_repair_manager),
) -> AudioRepairJobResponse:
    return _response(manager.get(db, job_id))


@router.post("/audio-repair-jobs/{job_id}/cancel", response_model=AudioRepairJobResponse)
def cancel_audio_repair(
    job_id: UUID,
    db: Session = Depends(get_db),
    manager: AudioRepairManager = Depends(get_audio_repair_manager),
) -> AudioRepairJobResponse:
    return _response(manager.cancel(db, job_id))


@router.post("/audio-repair-jobs/{job_id}/apply", response_model=AudioRepairJobResponse)
def apply_audio_repair(
    job_id: UUID,
    db: Session = Depends(get_db),
    manager: AudioRepairManager = Depends(get_audio_repair_manager),
) -> AudioRepairJobResponse:
    """Make the repaired video the project media source (reel / transcript / render)."""
    return _response(manager.apply_to_project(db, job_id))


@router.get("/audio-repair-jobs/{job_id}/audio")
def get_repaired_audio(
    job_id: UUID,
    download: bool = False,
    db: Session = Depends(get_db),
    manager: AudioRepairManager = Depends(get_audio_repair_manager),
) -> FileResponse:
    job = manager.get(db, job_id)
    path = manager.repaired_audio_path(job)
    return FileResponse(
        path,
        media_type="audio/wav",
        filename=job.repaired_audio_filename,
        content_disposition_type="attachment" if download else "inline",
    )


@router.get("/audio-repair-jobs/{job_id}/original-audio")
def get_original_audio(
    job_id: UUID,
    download: bool = False,
    db: Session = Depends(get_db),
    manager: AudioRepairManager = Depends(get_audio_repair_manager),
) -> FileResponse:
    job = manager.get(db, job_id)
    path = manager.original_audio_path(job)
    return FileResponse(
        path,
        media_type="audio/wav",
        filename="original-audio.wav",
        content_disposition_type="attachment" if download else "inline",
    )


@router.get("/audio-repair-jobs/{job_id}/video")
def get_repaired_video(
    job_id: UUID,
    download: bool = False,
    db: Session = Depends(get_db),
    manager: AudioRepairManager = Depends(get_audio_repair_manager),
) -> FileResponse:
    job = manager.get(db, job_id)
    path = manager.repaired_video_path(job)
    media_types = {
        ".mp4": "video/mp4",
        ".mov": "video/quicktime",
        ".webm": "video/webm",
        ".mkv": "video/x-matroska",
    }
    return FileResponse(
        path,
        media_type=media_types.get(path.suffix.lower(), "application/octet-stream"),
        filename=job.repaired_video_filename,
        content_disposition_type="attachment" if download else "inline",
    )
