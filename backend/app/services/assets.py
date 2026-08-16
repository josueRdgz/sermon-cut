"""Project media-bin assets (images and B-roll video)."""

from __future__ import annotations

from collections.abc import AsyncIterator
from pathlib import Path
from uuid import UUID, uuid4

from PIL import Image
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.exceptions import NotFoundError, ValidationAppError
from app.models.asset import ProjectAsset, ProjectAssetKind
from app.schemas.asset import ProjectAssetResponse
from app.services import projects as projects_service
from app.services import storage
from app.services.ffprobe import probe_video

_ASSET_IMAGE_EXTENSIONS = storage.COVER_EXTENSIONS
_ASSET_IMAGE_MIMES = storage.COVER_MIME_TYPES
_ASSET_VIDEO_EXTENSIONS = storage.VIDEO_EXTENSIONS
_ASSET_VIDEO_MIMES = storage.VIDEO_MIME_TYPES

_IMAGE_MEDIA_TYPES = {
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".webp": "image/webp",
}
_VIDEO_MEDIA_TYPES = {
    ".mp4": "video/mp4",
    ".mov": "video/quicktime",
    ".mkv": "video/x-matroska",
    ".webm": "video/webm",
}


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
        duration_ms=asset.duration_ms,
        created_at=asset.created_at,
        media_url=media_url(asset.project_id, asset.id),
    )


def list_assets(db: Session, project_id: UUID) -> list[ProjectAsset]:
    projects_service.get_project(db, project_id)
    return list(
        db.scalars(
            select(ProjectAsset)
            .where(ProjectAsset.project_id == project_id)
            .order_by(ProjectAsset.created_at.desc())
        ).all()
    )


def get_asset(db: Session, project_id: UUID, asset_id: UUID) -> ProjectAsset:
    projects_service.get_project(db, project_id)
    asset = db.get(ProjectAsset, asset_id)
    if asset is None or asset.project_id != project_id:
        raise NotFoundError("Asset not found.", code="asset_not_found")
    return asset


def resolve_asset_path(project_id: UUID, asset: ProjectAsset) -> Path:
    return storage.resolve_inside_project(project_id, asset.storage_path)


def media_type_for(asset: ProjectAsset) -> str:
    suffix = Path(asset.filename).suffix.lower()
    if asset.kind == ProjectAssetKind.video:
        return _VIDEO_MEDIA_TYPES.get(suffix, "video/mp4")
    return _IMAGE_MEDIA_TYPES.get(suffix, "image/png")


def _classify_upload(filename: str, content_type: str | None) -> ProjectAssetKind:
    suffix = Path(filename).suffix.lower()
    if suffix in _ASSET_IMAGE_EXTENSIONS:
        storage.validate_mime(content_type, _ASSET_IMAGE_MIMES)
        return ProjectAssetKind.image
    if suffix in _ASSET_VIDEO_EXTENSIONS:
        storage.validate_mime(content_type, _ASSET_VIDEO_MIMES)
        return ProjectAssetKind.video
    raise ValidationAppError(
        "Unsupported asset. Upload an image (JPEG, PNG, WebP) or a video clip "
        "(MP4, MOV, MKV, WebM).",
        code="unsupported_asset",
    )


def _image_size(path: Path) -> tuple[int | None, int | None]:
    try:
        with Image.open(path) as image:
            return image.width, image.height
    except OSError:
        return None, None


async def create_asset(
    db: Session,
    project_id: UUID,
    *,
    original_filename: str | None,
    content_type: str | None,
    chunks: AsyncIterator[bytes],
) -> ProjectAsset:
    project = projects_service.get_project(db, project_id)
    settings = get_settings()
    safe_name = storage.sanitize_filename(original_filename, fallback_stem="asset")
    kind = _classify_upload(safe_name, content_type)
    extension = Path(safe_name).suffix.lower()
    stored_name = f"asset-{uuid4().hex}{extension}"
    destination = storage.resolve_inside_project(project.id, stored_name)

    max_bytes = (
        settings.max_upload_bytes
        if kind == ProjectAssetKind.video
        else settings.max_cover_upload_bytes
    )
    await storage.save_upload_stream(destination, chunks, max_bytes=max_bytes)
    storage.assert_file_magic(
        destination,
        kind="video" if kind == ProjectAssetKind.video else "image",
    )

    width = height = duration_ms = None
    if kind == ProjectAssetKind.image:
        width, height = _image_size(destination)
    else:
        metadata = probe_video(destination)
        width, height = metadata.width, metadata.height
        if metadata.duration_seconds and metadata.duration_seconds > 0:
            duration_ms = int(round(metadata.duration_seconds * 1000))

    asset = ProjectAsset(
        project_id=project.id,
        kind=kind,
        filename=Path(stored_name).name,
        storage_path=stored_name,
        original_name=original_filename,
        width=width,
        height=height,
        duration_ms=duration_ms,
    )
    db.add(asset)
    db.commit()
    db.refresh(asset)
    return asset


def delete_asset(db: Session, project_id: UUID, asset_id: UUID) -> None:
    asset = get_asset(db, project_id, asset_id)
    path = resolve_asset_path(project_id, asset)
    db.delete(asset)
    db.commit()
    path.unlink(missing_ok=True)
