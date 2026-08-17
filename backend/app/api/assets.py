"""Upload and stream project media-bin assets."""

from __future__ import annotations

from collections.abc import AsyncIterator
from uuid import UUID

from fastapi import APIRouter, Depends, File, UploadFile
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

from app.core.exceptions import NotFoundError
from app.db.session import get_db
from app.schemas.asset import ProjectAssetListResponse, ProjectAssetResponse
from app.services import assets as assets_service
from app.services.projects import require_non_empty_upload

router = APIRouter(tags=["assets"])

_NO_CACHE_HEADERS = {"Cache-Control": "private, no-cache"}


async def _upload_chunks(upload: UploadFile) -> AsyncIterator[bytes]:
    while True:
        chunk = await upload.read(1024 * 1024)
        if not chunk:
            break
        yield chunk


@router.get("/projects/{project_id}/assets", response_model=ProjectAssetListResponse)
def list_assets(project_id: UUID, db: Session = Depends(get_db)) -> ProjectAssetListResponse:
    items = assets_service.list_assets(db, project_id)
    return ProjectAssetListResponse(
        items=[assets_service.to_response(item) for item in items],
        total=len(items),
    )


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
    require_non_empty_upload(file.filename)
    asset = await assets_service.create_asset(
        db,
        project_id,
        original_filename=file.filename,
        content_type=file.content_type,
        chunks=_upload_chunks(file),
    )
    return assets_service.to_response(asset)


@router.get("/projects/{project_id}/assets/{asset_id}/media")
def stream_asset(
    project_id: UUID,
    asset_id: UUID,
    db: Session = Depends(get_db),
) -> FileResponse:
    asset = assets_service.get_asset(db, project_id, asset_id)
    path = assets_service.resolve_asset_path(project_id, asset)
    if not path.is_file():
        raise NotFoundError("Asset file is missing on disk.", code="asset_missing")
    return FileResponse(
        path,
        media_type=assets_service.media_type_for(asset),
        filename=asset.original_name or asset.filename,
        content_disposition_type="inline",
        headers=_NO_CACHE_HEADERS,
    )


@router.delete("/projects/{project_id}/assets/{asset_id}", status_code=204)
def delete_asset(
    project_id: UUID,
    asset_id: UUID,
    db: Session = Depends(get_db),
) -> None:
    assets_service.delete_asset(db, project_id, asset_id)
