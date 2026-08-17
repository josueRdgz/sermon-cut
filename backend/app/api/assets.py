"""Media-bin asset endpoints."""

from __future__ import annotations

from collections.abc import AsyncIterator
from uuid import UUID

from fastapi import APIRouter, Depends, File, UploadFile
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.schemas.project_asset import ProjectAssetListResponse, ProjectAssetResponse
from app.services import assets as assets_service

router = APIRouter(tags=["assets"])

_IMAGE_MEDIA_TYPES: dict[str, str] = {
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".webp": "image/webp",
}

_NO_CACHE = {"Cache-Control": "private, no-cache"}


async def _chunks(upload: UploadFile) -> AsyncIterator[bytes]:
    while True:
        chunk = await upload.read(1024 * 1024)
        if not chunk:
            break
        yield chunk


@router.get("/projects/{project_id}/assets", response_model=ProjectAssetListResponse)
def list_assets(project_id: UUID, db: Session = Depends(get_db)) -> ProjectAssetListResponse:
    return assets_service.list_assets(db, project_id)


@router.post(
    "/projects/{project_id}/assets",
    response_model=ProjectAssetResponse,
    status_code=201,
)
async def upload_asset(
    project_id: UUID,
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
) -> ProjectAssetResponse:
    asset = await assets_service.create_image_asset(
        db,
        project_id,
        original_name=file.filename,
        content_type=file.content_type,
        chunks=_chunks(file),
    )
    return assets_service.to_response(asset)


@router.get("/projects/{project_id}/assets/{asset_id}/media")
def get_asset_media(
    project_id: UUID,
    asset_id: UUID,
    db: Session = Depends(get_db),
) -> FileResponse:
    asset = assets_service.get_asset(db, project_id, asset_id)
    path = assets_service.resolve_asset_path(project_id, asset)
    media_type = _IMAGE_MEDIA_TYPES.get(path.suffix.lower(), "application/octet-stream")
    return FileResponse(
        path,
        media_type=media_type,
        filename=asset.original_name or asset.filename,
        headers=_NO_CACHE,
    )


@router.delete("/projects/{project_id}/assets/{asset_id}", status_code=204)
def delete_asset(project_id: UUID, asset_id: UUID, db: Session = Depends(get_db)) -> None:
    assets_service.delete_asset(db, project_id, asset_id)
