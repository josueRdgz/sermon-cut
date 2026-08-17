"""Project media-bin asset storage and CRUD."""

from __future__ import annotations

from collections.abc import AsyncIterator
from pathlib import Path
from uuid import UUID, uuid4

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.exceptions import NotFoundError, ValidationAppError
from app.core.paths import project_dir
from app.models.project_asset import ProjectAsset, ProjectAssetKind
from app.schemas.project_asset import ProjectAssetListResponse, ProjectAssetResponse
from app.services import projects as projects_service
from app.services import storage

IMAGE_EXTENSIONS = storage.COVER_EXTENSIONS
IMAGE_MIME_TYPES = storage.COVER_MIME_TYPES


def assets_subdir(project_id: UUID) -> Path:
    path = project_dir(project_id) / "assets"
    path.mkdir(parents=True, exist_ok=True)
    return path


def media_url(project_id: UUID, asset_id: UUID) -> str:
    return f"/api/projects/{project_id}/assets/{asset_id}/media"


def to_response(asset: ProjectAsset) -> ProjectAssetResponse:
    return ProjectAssetResponse(
        id=asset.id,
        project_id=asset.project_id,
        kind=asset.kind,
        filename=asset.filename,
        storage_path=asset.storage_path,
        original_name=asset.original_name,
        width=asset.width,
        height=asset.height,
        created_at=asset.created_at,
        media_url=media_url(asset.project_id, asset.id),
    )


def list_assets(db: Session, project_id: UUID) -> ProjectAssetListResponse:
    projects_service.get_project(db, project_id)
    rows = list(
        db.scalars(
            select(ProjectAsset)
            .where(ProjectAsset.project_id == project_id)
            .order_by(ProjectAsset.created_at.desc())
        )
    )
    return ProjectAssetListResponse(items=[to_response(row) for row in rows], total=len(rows))


def get_asset(db: Session, project_id: UUID, asset_id: UUID) -> ProjectAsset:
    projects_service.get_project(db, project_id)
    asset = db.get(ProjectAsset, asset_id)
    if asset is None or asset.project_id != project_id:
        raise NotFoundError("Asset not found.", code="asset_not_found")
    return asset


def resolve_asset_path(project_id: UUID, asset: ProjectAsset) -> Path:
    path = storage.resolve_inside_project(project_id, asset.storage_path)
    if not path.is_file():
        raise NotFoundError("Asset file is missing on disk.", code="asset_file_missing")
    return path


async def create_image_asset(
    db: Session,
    project_id: UUID,
    *,
    original_name: str | None,
    content_type: str | None,
    chunks: AsyncIterator[bytes],
) -> ProjectAsset:
    project = projects_service.get_project(db, project_id)
    safe_name = storage.sanitize_filename(original_name, fallback_stem="asset")
    storage.validate_extension(safe_name, IMAGE_EXTENSIONS)
    storage.validate_mime(content_type, IMAGE_MIME_TYPES)

    asset_id = uuid4()
    relative = f"assets/{asset_id.hex}{Path(safe_name).suffix.lower()}"
    destination = storage.resolve_inside_project(project.id, relative)
    destination.parent.mkdir(parents=True, exist_ok=True)

    max_bytes = get_settings().max_upload_bytes
    await storage.save_upload_stream(destination, chunks, max_bytes=max_bytes)
    storage.assert_file_magic(destination, kind="image")

    width = height = None
    try:
        from PIL import Image

        with Image.open(destination) as image:
            width, height = image.size
    except Exception:  # noqa: BLE001 — dimensions are optional metadata
        width = height = None

    asset = ProjectAsset(
        id=asset_id,
        project_id=project.id,
        kind=ProjectAssetKind.image,
        filename=Path(relative).name,
        storage_path=relative,
        original_name=original_name,
        width=width,
        height=height,
    )
    db.add(asset)
    db.commit()
    db.refresh(asset)
    return asset


def delete_asset(db: Session, project_id: UUID, asset_id: UUID) -> None:
    asset = get_asset(db, project_id, asset_id)
    path = storage.resolve_inside_project(project_id, asset.storage_path)
    db.delete(asset)
    db.commit()
    path.unlink(missing_ok=True)
