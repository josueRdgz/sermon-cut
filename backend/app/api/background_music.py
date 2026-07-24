"""API for optional local background music (never downloaded / no catalogues)."""

from __future__ import annotations

from collections.abc import AsyncIterator
from uuid import UUID

from fastapi import APIRouter, Depends, File, UploadFile
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.schemas.background_music import (
    BackgroundMusicMetersResponse,
    BackgroundMusicPresetListResponse,
    BackgroundMusicResponse,
    BackgroundMusicUpdate,
)
from app.services import projects as projects_service
from app.services.background_music import service as bgm_service

router = APIRouter(tags=["background-music"])


async def _upload_chunks(upload: UploadFile) -> AsyncIterator[bytes]:
    while True:
        chunk = await upload.read(1024 * 1024)
        if not chunk:
            break
        yield chunk


@router.get("/background-music/presets", response_model=BackgroundMusicPresetListResponse)
def list_background_music_presets() -> BackgroundMusicPresetListResponse:
    return BackgroundMusicPresetListResponse(items=bgm_service.list_presets())


@router.get(
    "/projects/{project_id}/background-music",
    response_model=BackgroundMusicResponse,
)
def get_background_music(
    project_id: UUID,
    db: Session = Depends(get_db),
) -> BackgroundMusicResponse:
    projects_service.get_project(db, project_id)
    row = bgm_service.get_settings_row(db, project_id)
    return bgm_service.to_response(row)


@router.put(
    "/projects/{project_id}/background-music",
    response_model=BackgroundMusicResponse,
)
def update_background_music(
    project_id: UUID,
    payload: BackgroundMusicUpdate,
    db: Session = Depends(get_db),
) -> BackgroundMusicResponse:
    projects_service.get_project(db, project_id)
    row = bgm_service.update_settings(db, project_id, payload)
    return bgm_service.to_response(row)


@router.post(
    "/projects/{project_id}/background-music/upload",
    response_model=BackgroundMusicResponse,
)
async def upload_background_music(
    project_id: UUID,
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
) -> BackgroundMusicResponse:
    """Store the user's own MP3/WAV/M4A/OGG inside the project directory."""
    projects_service.get_project(db, project_id)
    row = await bgm_service.attach_music(
        db,
        project_id,
        original_filename=file.filename,
        content_type=file.content_type,
        chunks=_upload_chunks(file),
    )
    return bgm_service.to_response(row)


@router.get(
    "/projects/{project_id}/background-music/meters",
    response_model=BackgroundMusicMetersResponse,
)
def get_background_music_meters(
    project_id: UUID,
    db: Session = Depends(get_db),
) -> BackgroundMusicMetersResponse:
    """Pre-export loudness / mix meters (spoken-word oriented)."""
    projects_service.get_project(db, project_id)
    return bgm_service.build_meters(db, project_id)
