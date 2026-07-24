"""Business logic for preaching projects."""

from __future__ import annotations

from collections.abc import AsyncIterator
from datetime import UTC, datetime
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.exceptions import NotFoundError, ValidationAppError
from app.models.project import Project, ProjectStatus
from app.schemas.project import ProjectCreate, ProjectResponse, ProjectUpdate
from app.services import storage
from app.services.ffprobe import probe_video


def _touch(project: Project) -> None:
    project.updated_at = datetime.now(UTC)


def to_response(project: Project) -> ProjectResponse:
    """Map an ORM project to the public response schema."""
    resolution: str | None = None
    if project.width and project.height:
        resolution = f"{project.width}x{project.height}"

    return ProjectResponse(
        id=project.id,
        title=project.title,
        preacher_name=project.preacher_name,
        bible_reference=project.bible_reference,
        church_name=project.church_name,
        youtube_channel=project.youtube_channel,
        full_sermon_url=project.full_sermon_url,
        video_filename=project.video_filename,
        cover_filename=project.cover_filename,
        has_video=bool(project.video_filename),
        has_cover=bool(project.cover_filename),
        created_at=project.created_at,
        updated_at=project.updated_at,
        duration_seconds=project.duration_seconds,
        width=project.width,
        height=project.height,
        fps=project.fps,
        video_codec=project.video_codec,
        audio_codec=project.audio_codec,
        resolution=resolution,
        status=project.status,
        error_message=project.error_message,
    )


def list_projects(db: Session) -> list[Project]:
    """Return all projects ordered by most recently updated."""
    stmt = select(Project).order_by(Project.updated_at.desc())
    return list(db.scalars(stmt).all())


def get_project(db: Session, project_id: UUID) -> Project:
    """Fetch a project by id or raise ``NotFoundError``."""
    project = db.get(Project, project_id)
    if project is None:
        raise NotFoundError("Project not found.", code="project_not_found")
    return project


def create_project(db: Session, payload: ProjectCreate) -> Project:
    """Persist a new project and create its empty storage directory."""
    project = Project(
        title=payload.title.strip(),
        preacher_name=payload.preacher_name.strip() if payload.preacher_name else None,
        bible_reference=payload.bible_reference.strip() if payload.bible_reference else None,
        church_name=payload.church_name.strip(),
        youtube_channel=payload.youtube_channel.strip(),
        full_sermon_url=str(payload.full_sermon_url) if payload.full_sermon_url else None,
        status=ProjectStatus.created,
    )
    db.add(project)
    db.commit()
    db.refresh(project)
    storage.ensure_project_dir(project.id)
    return project


def update_project(db: Session, project_id: UUID, payload: ProjectUpdate) -> Project:
    """Apply a partial metadata update."""
    project = get_project(db, project_id)
    data = payload.model_dump(exclude_unset=True)

    if "full_sermon_url" in data:
        url = data["full_sermon_url"]
        data["full_sermon_url"] = str(url) if url is not None else None

    for field, value in data.items():
        if isinstance(value, str):
            value = value.strip()
        setattr(project, field, value)

    _touch(project)
    db.commit()
    db.refresh(project)
    return project


def delete_project(db: Session, project_id: UUID) -> None:
    """Delete the project row and its on-disk folder."""
    project = get_project(db, project_id)
    storage.delete_project_dir(project.id)
    db.delete(project)
    db.commit()


async def attach_video(
    db: Session,
    project_id: UUID,
    *,
    original_filename: str | None,
    content_type: str | None,
    chunks: AsyncIterator[bytes],
) -> Project:
    """Store an uploaded video, probe metadata with FFprobe, and update status."""
    project = get_project(db, project_id)
    settings = get_settings()

    safe_name = storage.sanitize_filename(original_filename, fallback_stem="video")
    storage.validate_extension(safe_name, storage.VIDEO_EXTENSIONS)
    storage.validate_mime(content_type, storage.VIDEO_MIME_TYPES)

    # Canonical on-disk name: original.<ext>
    extension = storage.validate_extension(safe_name, storage.VIDEO_EXTENSIONS)
    stored_name = f"original{extension}"
    destination = storage.resolve_inside_project(project.id, stored_name)

    project.status = ProjectStatus.importing
    project.error_message = None
    _touch(project)
    db.commit()

    try:
        await storage.save_upload_stream(
            destination,
            chunks,
            max_bytes=settings.max_upload_bytes,
        )
        storage.assert_file_magic(destination, kind="video")
    except Exception as exc:
        project.status = ProjectStatus.failed
        project.error_message = str(getattr(exc, "detail", exc))
        _touch(project)
        db.commit()
        raise

    try:
        return finalize_project_video(db, project, stored_name)
    except Exception as exc:
        project.status = ProjectStatus.failed
        project.error_message = str(getattr(exc, "detail", exc))
        _touch(project)
        db.commit()
        raise


def finalize_project_video(
    db: Session,
    project: Project,
    stored_name: str,
    *,
    verify_magic: bool = False,
) -> Project:
    """Probe a video already on disk and register it as the project's original.

    Shared by local upload and YouTube import: both paths land a file under the
    project directory, then hand it to FFprobe and update project metadata /
    status identically. The rest of the SermonCut pipeline is unchanged.
    """
    destination = storage.resolve_inside_project(project.id, stored_name)
    if verify_magic:
        storage.assert_file_magic(destination, kind="video")
    metadata = probe_video(destination)

    # Replace any previous video file with a different name/extension.
    if project.video_filename and project.video_filename != stored_name:
        old = storage.resolve_inside_project(project.id, project.video_filename)
        old.unlink(missing_ok=True)

    project.video_filename = stored_name
    project.duration_seconds = metadata.duration_seconds
    project.width = metadata.width
    project.height = metadata.height
    project.fps = metadata.fps
    project.video_codec = metadata.video_codec
    project.audio_codec = metadata.audio_codec
    project.status = ProjectStatus.ready
    project.error_message = None
    _touch(project)
    db.commit()
    db.refresh(project)
    return project


async def attach_cover(
    db: Session,
    project_id: UUID,
    *,
    original_filename: str | None,
    content_type: str | None,
    chunks: AsyncIterator[bytes],
) -> Project:
    """Store an uploaded cover image for the project."""
    project = get_project(db, project_id)
    settings = get_settings()

    safe_name = storage.sanitize_filename(original_filename, fallback_stem="cover")
    storage.validate_extension(safe_name, storage.COVER_EXTENSIONS)
    storage.validate_mime(content_type, storage.COVER_MIME_TYPES)

    extension = storage.validate_extension(safe_name, storage.COVER_EXTENSIONS)
    stored_name = f"cover{extension}"
    destination = storage.resolve_inside_project(project.id, stored_name)

    await storage.save_upload_stream(
        destination,
        chunks,
        max_bytes=settings.max_cover_upload_bytes,
    )
    storage.assert_file_magic(destination, kind="image")

    if project.cover_filename and project.cover_filename != stored_name:
        old = storage.resolve_inside_project(project.id, project.cover_filename)
        old.unlink(missing_ok=True)

    project.cover_filename = stored_name
    _touch(project)
    db.commit()
    db.refresh(project)
    return project


def require_non_empty_upload(filename: str | None) -> None:
    """Reject uploads that arrive without a filename."""
    if not filename:
        raise ValidationAppError("Missing upload filename.", code="missing_filename")
