"""CRUD and media-upload endpoints for preaching projects."""

from __future__ import annotations

from collections.abc import AsyncIterator
from pathlib import Path
from uuid import UUID

from fastapi import APIRouter, Depends, File, UploadFile
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

from app.core.exceptions import NotFoundError
from app.db.session import get_db
from app.schemas.project import (
    ProjectCreate,
    ProjectListResponse,
    ProjectResponse,
    ProjectUpdate,
    SermonRangeRequest,
)
from app.services import projects as projects_service
from app.services import storage
from app.services.media_audio import preview_audio_path

router = APIRouter(prefix="/projects", tags=["projects"])

_VIDEO_MEDIA_TYPES: dict[str, str] = {
    ".mp4": "video/mp4",
    ".mov": "video/quicktime",
    ".mkv": "video/x-matroska",
    ".webm": "video/webm",
}

_COVER_MEDIA_TYPES: dict[str, str] = {
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".webp": "image/webp",
}

_NO_CACHE_HEADERS = {"Cache-Control": "private, no-cache"}


async def _upload_chunks(upload: UploadFile) -> AsyncIterator[bytes]:
    """Yield the upload body in chunks without loading it all into memory."""
    while True:
        chunk = await upload.read(1024 * 1024)
        if not chunk:
            break
        yield chunk


@router.post("", response_model=ProjectResponse, status_code=201)
def create_project(
    payload: ProjectCreate,
    db: Session = Depends(get_db),
) -> ProjectResponse:
    """Create a project with metadata only. Upload media afterwards."""
    project = projects_service.create_project(db, payload)
    return projects_service.to_response(project)


@router.get("", response_model=ProjectListResponse)
def list_projects(db: Session = Depends(get_db)) -> ProjectListResponse:
    """List every local project, newest updates first."""
    items = projects_service.list_projects(db)
    return ProjectListResponse(
        items=[projects_service.to_response(p) for p in items],
        total=len(items),
    )


@router.get("/{project_id}", response_model=ProjectResponse)
def get_project(project_id: UUID, db: Session = Depends(get_db)) -> ProjectResponse:
    """Return a single project by id."""
    project = projects_service.get_project(db, project_id)
    return projects_service.to_response(project)


@router.patch("/{project_id}", response_model=ProjectResponse)
def update_project(
    project_id: UUID,
    payload: ProjectUpdate,
    db: Session = Depends(get_db),
) -> ProjectResponse:
    """Update project metadata."""
    project = projects_service.update_project(db, project_id, payload)
    return projects_service.to_response(project)


@router.post("/{project_id}/sermon-range", response_model=ProjectResponse)
def apply_sermon_range(
    project_id: UUID,
    payload: SermonRangeRequest,
    db: Session = Depends(get_db),
) -> ProjectResponse:
    """Keep only the preaching window as the working video for later editing."""
    project = projects_service.apply_sermon_range(
        db,
        project_id,
        start=payload.start_seconds,
        end=payload.end_seconds,
    )
    return projects_service.to_response(project)


@router.delete("/{project_id}", status_code=204)
def delete_project(project_id: UUID, db: Session = Depends(get_db)) -> None:
    """Delete a project and its local storage folder."""
    projects_service.delete_project(db, project_id)


@router.post("/{project_id}/video", response_model=ProjectResponse)
async def upload_video(
    project_id: UUID,
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
) -> ProjectResponse:
    """Upload the original sermon video (MP4, MOV, MKV or WebM)."""
    projects_service.require_non_empty_upload(file.filename)
    project = await projects_service.attach_video(
        db,
        project_id,
        original_filename=file.filename,
        content_type=file.content_type,
        chunks=_upload_chunks(file),
    )
    return projects_service.to_response(project)


@router.delete("/{project_id}/video", response_model=ProjectResponse)
def delete_video(
    project_id: UUID,
    db: Session = Depends(get_db),
) -> ProjectResponse:
    """Delete source video files but keep transcript, edits and prior exports."""
    project = projects_service.delete_video(db, project_id)
    return projects_service.to_response(project)


@router.post("/{project_id}/cover", response_model=ProjectResponse)
async def upload_cover(
    project_id: UUID,
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
) -> ProjectResponse:
    """Upload the sermon cover image (JPEG, PNG or WebP)."""
    projects_service.require_non_empty_upload(file.filename)
    project = await projects_service.attach_cover(
        db,
        project_id,
        original_filename=file.filename,
        content_type=file.content_type,
        chunks=_upload_chunks(file),
    )
    return projects_service.to_response(project)


@router.get("/{project_id}/media/video")
def stream_project_video(project_id: UUID, db: Session = Depends(get_db)) -> FileResponse:
    """Stream the project video for the HTML5 player (supports HTTP Range).

    The browser seeks via Range requests; the file is never loaded fully into
    application memory.
    """
    project = projects_service.get_project(db, project_id)
    if not project.video_filename:
        raise NotFoundError("Project has no video.", code="video_not_found")

    path = storage.resolve_inside_project(project.id, project.video_filename)
    if not path.is_file():
        raise NotFoundError("Video file is missing on disk.", code="video_not_found")

    media_type = _VIDEO_MEDIA_TYPES.get(Path(project.video_filename).suffix.lower(), "video/mp4")
    return FileResponse(
        path,
        media_type=media_type,
        filename=project.video_filename,
        content_disposition_type="inline",
        headers=_NO_CACHE_HEADERS,
    )


@router.get("/{project_id}/media/audio")
def stream_project_audio(project_id: UUID, db: Session = Depends(get_db)) -> FileResponse:
    """Stream a dedicated AAC/WAV track for HTML5 ``<audio>`` preview."""
    project = projects_service.get_project(db, project_id)
    path = preview_audio_path(project.id, project.video_filename or "")
    media_types = {
        ".wav": "audio/wav",
        ".m4a": "audio/mp4",
        ".aac": "audio/aac",
        ".mp3": "audio/mpeg",
    }
    return FileResponse(
        path,
        media_type=media_types.get(path.suffix.lower(), "audio/mp4"),
        filename=path.name,
        content_disposition_type="inline",
        headers=_NO_CACHE_HEADERS,
    )


@router.get("/{project_id}/media/cover")
def stream_project_cover(project_id: UUID, db: Session = Depends(get_db)) -> FileResponse:
    """Serve the project cover image (used as a thumbnail in the library)."""
    project = projects_service.get_project(db, project_id)
    if not project.cover_filename:
        raise NotFoundError("Project has no cover.", code="cover_not_found")

    path = storage.resolve_inside_project(project.id, project.cover_filename)
    if not path.is_file():
        raise NotFoundError("Cover file is missing on disk.", code="cover_not_found")

    media_type = _COVER_MEDIA_TYPES.get(Path(project.cover_filename).suffix.lower(), "image/jpeg")
    return FileResponse(
        path,
        media_type=media_type,
        filename=project.cover_filename,
        content_disposition_type="inline",
    )
