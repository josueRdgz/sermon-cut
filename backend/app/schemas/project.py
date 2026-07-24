"""Pydantic schemas for preaching projects."""

from __future__ import annotations

from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, HttpUrl

from app.models.project import ProjectStatus


class ProjectCreate(BaseModel):
    """Payload to create a new project (metadata only; media via upload endpoints)."""

    title: str = Field(min_length=1, max_length=300)
    preacher_name: str | None = Field(default=None, max_length=200)
    bible_reference: str | None = Field(default=None, max_length=200)
    church_name: str = Field(min_length=1, max_length=200)
    youtube_channel: str = Field(min_length=1, max_length=200)
    full_sermon_url: HttpUrl | None = None


class ProjectUpdate(BaseModel):
    """Partial update of project metadata."""

    title: str | None = Field(default=None, min_length=1, max_length=300)
    preacher_name: str | None = Field(default=None, max_length=200)
    bible_reference: str | None = Field(default=None, max_length=200)
    church_name: str | None = Field(default=None, min_length=1, max_length=200)
    youtube_channel: str | None = Field(default=None, min_length=1, max_length=200)
    full_sermon_url: HttpUrl | None = None
    status: ProjectStatus | None = None


class ProjectResponse(BaseModel):
    """Public representation of a project."""

    model_config = ConfigDict(from_attributes=True)

    id: UUID
    title: str
    preacher_name: str | None
    bible_reference: str | None
    church_name: str
    youtube_channel: str
    full_sermon_url: str | None

    video_filename: str | None
    cover_filename: str | None
    has_video: bool
    has_cover: bool

    created_at: datetime
    updated_at: datetime

    duration_seconds: float | None
    width: int | None
    height: int | None
    fps: float | None
    video_codec: str | None
    audio_codec: str | None
    resolution: str | None

    status: ProjectStatus
    error_message: str | None


class ProjectListResponse(BaseModel):
    """List wrapper for GET /api/projects."""

    items: list[ProjectResponse]
    total: int


class ErrorBody(BaseModel):
    """Structured error payload returned by the API."""

    detail: str
    code: str
