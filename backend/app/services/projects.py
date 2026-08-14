"""Business logic for preaching projects."""

from __future__ import annotations

from collections.abc import AsyncIterator
from datetime import UTC, datetime
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.exceptions import ConflictError, NotFoundError, ValidationAppError
from app.models.project import Project, ProjectSourceKind, ProjectStatus
from app.schemas.project import ProjectCreate, ProjectResponse, ProjectUpdate
from app.services import storage
from app.services.ffprobe import probe_video
from app.services.sermon_range import extract_window, should_trim


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
        content_mode=project.content_mode,
        source_kind=project.source_kind,
        sermon_start_seconds=project.sermon_start_seconds,
        sermon_end_seconds=project.sermon_end_seconds,
        sermon_range_confirmed=bool(project.sermon_range_confirmed),
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
    """Persist metadata; storage is created lazily when the first file arrives."""
    project = Project(
        title=payload.title.strip(),
        preacher_name=payload.preacher_name.strip() if payload.preacher_name else None,
        bible_reference=payload.bible_reference.strip() if payload.bible_reference else None,
        church_name=payload.church_name.strip(),
        youtube_channel=payload.youtube_channel.strip(),
        full_sermon_url=str(payload.full_sermon_url) if payload.full_sermon_url else None,
        content_mode=payload.content_mode,
        source_kind=payload.source_kind,
        sermon_range_confirmed=payload.source_kind == ProjectSourceKind.sermon_only,
        status=ProjectStatus.created,
    )
    db.add(project)
    db.commit()
    db.refresh(project)
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


def delete_video(db: Session, project_id: UUID) -> Project:
    """Delete source videos while retaining transcript, Reel edits and exports."""
    project = get_project(db, project_id)
    if project.status in {
        ProjectStatus.importing,
        ProjectStatus.transcribing,
        ProjectStatus.analyzing,
        ProjectStatus.rendering,
    }:
        raise ConflictError(
            "No se puede eliminar el video mientras hay un proceso activo.",
            code="project_busy",
        )
    if not project.video_filename:
        raise NotFoundError("Project has no video.", code="video_not_found")

    storage.delete_project_video_files(project.id)
    project.video_filename = None
    project.duration_seconds = None
    project.width = None
    project.height = None
    project.fps = None
    project.video_codec = None
    project.audio_codec = None
    project.sermon_start_seconds = None
    project.sermon_end_seconds = None
    project.sermon_range_confirmed = project.source_kind == ProjectSourceKind.sermon_only
    project.status = ProjectStatus.created
    project.error_message = None
    _touch(project)
    db.commit()
    db.refresh(project)
    return project


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
        storage.remove_project_dir_if_empty(project.id)
        project.status = ProjectStatus.failed
        project.error_message = str(getattr(exc, "detail", exc))
        _touch(project)
        db.commit()
        raise

    try:
        return finalize_project_video(db, project, stored_name)
    except Exception as exc:
        destination.unlink(missing_ok=True)
        storage.remove_project_dir_if_empty(project.id)
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
    _sync_default_sermon_window(project)
    project.status = ProjectStatus.ready
    project.error_message = None
    _touch(project)
    db.commit()
    db.refresh(project)
    return project


def _sync_default_sermon_window(project: Project) -> None:
    duration = float(project.duration_seconds or 0)
    if project.source_kind == ProjectSourceKind.sermon_only and duration > 0:
        project.sermon_start_seconds = 0.0
        project.sermon_end_seconds = duration
        project.sermon_range_confirmed = True
        return
    if project.sermon_start_seconds is None:
        project.sermon_start_seconds = 0.0
    if project.sermon_end_seconds is None and duration > 0:
        project.sermon_end_seconds = duration


def apply_sermon_range(db: Session, project_id: UUID, *, start: float, end: float) -> Project:
    """Save the preaching window and replace the working video with that clip."""
    project = get_project(db, project_id)
    if project.status in {
        ProjectStatus.importing,
        ProjectStatus.transcribing,
        ProjectStatus.analyzing,
        ProjectStatus.rendering,
    }:
        raise ConflictError(
            "No se puede recortar la predicación mientras hay un proceso activo.",
            code="project_busy",
        )
    if not project.video_filename:
        raise NotFoundError("Project has no video.", code="video_not_found")

    duration = float(project.duration_seconds or 0)
    start = max(0.0, float(start))
    end = min(duration, float(end)) if duration > 0 else float(end)
    if end - start < 1.0:
        raise ValidationAppError(
            "El intervalo de la predicación debe durar al menos 1 segundo.",
            code="sermon_range_too_short",
        )
    if duration > 0 and end > duration + 0.5:
        raise ValidationAppError(
            "El final supera la duración del video.",
            code="sermon_range_out_of_bounds",
        )

    if should_trim(start=start, end=end, duration=duration):
        source = storage.resolve_inside_project(project.id, project.video_filename)
        if not source.is_file():
            raise NotFoundError("Video file is missing on disk.", code="video_not_found")
        suffix = source.suffix.lower() or ".mp4"
        destination = storage.resolve_inside_project(project.id, f"sermon{suffix}")
        extract_window(source, destination, start=start, end=end)
        project = finalize_project_video(db, project, destination.name)
        project.sermon_start_seconds = 0.0
        project.sermon_end_seconds = project.duration_seconds
        project.sermon_range_confirmed = True
        _touch(project)
        db.commit()
        db.refresh(project)
        return project

    project.sermon_start_seconds = round(start, 3)
    project.sermon_end_seconds = round(end, 3)
    project.sermon_range_confirmed = True
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
