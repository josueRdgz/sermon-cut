"""Schemas for project media-bin assets."""

from __future__ import annotations

from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict

from app.models.project_asset import ProjectAssetKind


class ProjectAssetResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    project_id: UUID
    kind: ProjectAssetKind
    filename: str
    storage_path: str
    original_name: str | None
    width: int | None
    height: int | None
    created_at: datetime
    media_url: str


class ProjectAssetListResponse(BaseModel):
    items: list[ProjectAssetResponse]
    total: int
