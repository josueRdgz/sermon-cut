"""Resolve, persist and materialize end card settings.

Resolution order: per-project row → global row → hardcoded defaults. The end
card itself is mandatory, so a project always resolves to a usable config.
"""

from __future__ import annotations

from collections.abc import AsyncIterator
from dataclasses import dataclass
from pathlib import Path
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.exceptions import ValidationAppError
from app.models.end_card import (
    CALL_TO_ACTION_TEXT,
    DEFAULT_AUDIO_FADE_OUT_MS,
    DEFAULT_END_CARD_SECONDS,
    DEFAULT_FADE_IN_MS,
    MAX_END_CARD_SECONDS,
    MIN_END_CARD_SECONDS,
    EndCardAudioMode,
    EndCardLayout,
    EndCardSettings,
)
from app.models.project import Project
from app.services import storage
from app.services.endcard.image import EndCardContent
from app.services.endcard.layout import clamp_duration


@dataclass(frozen=True)
class ResolvedEndCard:
    """Effective end card configuration for one project."""

    layout: EndCardLayout
    duration_seconds: float
    fade_in_ms: int
    audio_fade_out_ms: int
    audio_mode: EndCardAudioMode
    music_filename: str | None
    music_volume: float
    logo_filename: str | None
    url_text: str | None
    show_qr: bool
    qr_url: str | None
    channel_handle: str | None
    custom_message: str | None
    # True when a project-specific row exists.
    is_project_override: bool


def get_global_settings(db: Session) -> EndCardSettings | None:
    return db.scalars(select(EndCardSettings).where(EndCardSettings.project_id.is_(None))).first()


def get_project_settings(db: Session, project_id: UUID) -> EndCardSettings | None:
    return db.scalars(
        select(EndCardSettings).where(EndCardSettings.project_id == project_id)
    ).first()


def resolve(db: Session, project_id: UUID) -> ResolvedEndCard:
    """Return the effective config: project override, else global, else defaults."""
    row = get_project_settings(db, project_id)
    is_override = row is not None
    if row is None:
        row = get_global_settings(db)
    return _from_row(row, is_override=is_override)


def resolve_global(db: Session) -> ResolvedEndCard:
    """Return the global defaults (built-in values when nothing is stored yet)."""
    return _from_row(get_global_settings(db), is_override=False)


def _from_row(row: EndCardSettings | None, *, is_override: bool) -> ResolvedEndCard:
    if row is None:
        return ResolvedEndCard(
            layout=EndCardLayout.cover_full,
            duration_seconds=DEFAULT_END_CARD_SECONDS,
            fade_in_ms=DEFAULT_FADE_IN_MS,
            audio_fade_out_ms=DEFAULT_AUDIO_FADE_OUT_MS,
            audio_mode=EndCardAudioMode.continue_with_fade,
            music_filename=None,
            music_volume=0.6,
            logo_filename=None,
            url_text=None,
            show_qr=False,
            qr_url=None,
            channel_handle=None,
            custom_message=None,
            is_project_override=is_override,
        )

    return ResolvedEndCard(
        layout=row.layout,
        duration_seconds=clamp_duration(
            row.duration_seconds, minimum=MIN_END_CARD_SECONDS, maximum=MAX_END_CARD_SECONDS
        ),
        fade_in_ms=max(0, row.fade_in_ms),
        audio_fade_out_ms=max(0, row.audio_fade_out_ms),
        audio_mode=row.audio_mode,
        music_filename=row.music_filename,
        music_volume=max(0.0, min(1.0, row.music_volume)),
        logo_filename=row.logo_filename,
        url_text=row.url_text,
        show_qr=row.show_qr,
        qr_url=row.qr_url,
        channel_handle=row.channel_handle,
        custom_message=row.custom_message,
        is_project_override=is_override,
    )


def upsert(
    db: Session,
    *,
    project_id: UUID | None,
    values: dict[str, object],
) -> EndCardSettings:
    """Create or update the global row (``project_id=None``) or a project row."""
    if project_id is not None and db.get(Project, project_id) is None:
        raise ValidationAppError("Project not found.", code="project_not_found")

    row = (
        get_project_settings(db, project_id) if project_id is not None else get_global_settings(db)
    )
    if row is None:
        row = EndCardSettings(project_id=project_id)
        db.add(row)

    duration = values.get("duration_seconds")
    if duration is not None:
        seconds = float(duration)  # type: ignore[arg-type]
        if seconds < MIN_END_CARD_SECONDS or seconds > MAX_END_CARD_SECONDS:
            raise ValidationAppError(
                f"The end card must last between {MIN_END_CARD_SECONDS:g} and "
                f"{MAX_END_CARD_SECONDS:g} seconds.",
                code="invalid_end_card_duration",
            )

    audio_mode = values.get("audio_mode")
    music = values.get("music_filename", row.music_filename)
    if audio_mode == EndCardAudioMode.local_music and not music:
        raise ValidationAppError(
            "Local music mode needs a music file uploaded for the project.",
            code="end_card_music_missing",
        )

    for key, value in values.items():
        if value is not None or key in {
            "music_filename",
            "logo_filename",
            "url_text",
            "qr_url",
            "channel_handle",
            "custom_message",
        }:
            setattr(row, key, value)

    db.commit()
    db.refresh(row)
    return row


LOGO_EXTENSIONS = frozenset({".png", ".jpg", ".jpeg", ".webp"})
LOGO_MIME_TYPES = frozenset({"image/png", "image/jpeg", "image/webp", "application/octet-stream"})
MUSIC_EXTENSIONS = frozenset({".mp3", ".m4a", ".aac", ".wav", ".flac", ".ogg"})
MUSIC_MIME_TYPES = frozenset(
    {
        "audio/mpeg",
        "audio/mp4",
        "audio/aac",
        "audio/x-m4a",
        "audio/wav",
        "audio/x-wav",
        "audio/flac",
        "audio/ogg",
        "application/octet-stream",
    }
)


async def _attach_asset(
    db: Session,
    project_id: UUID,
    *,
    original_filename: str | None,
    content_type: str | None,
    chunks: AsyncIterator[bytes],
    field: str,
    stem: str,
    extensions: frozenset[str],
    mime_types: frozenset[str],
) -> EndCardSettings:
    """Store a user-provided end card asset inside the project folder."""
    if db.get(Project, project_id) is None:
        raise ValidationAppError("Project not found.", code="project_not_found")

    safe_name = storage.sanitize_filename(original_filename, fallback_stem=stem)
    extension = storage.validate_extension(safe_name, extensions)
    storage.validate_mime(content_type, mime_types)

    settings = get_settings()
    destination = storage.resolve_inside_project(project_id, f"{stem}{extension}")
    # Replace any previously uploaded asset of the same kind.
    for existing in extensions:
        previous = storage.resolve_inside_project(project_id, f"{stem}{existing}")
        if previous != destination and previous.is_file():
            previous.unlink(missing_ok=True)

    await storage.save_upload_stream(destination, chunks, max_bytes=settings.max_upload_bytes)
    return upsert(db, project_id=project_id, values={field: destination.name})


async def attach_logo(
    db: Session,
    project_id: UUID,
    *,
    original_filename: str | None,
    content_type: str | None,
    chunks: AsyncIterator[bytes],
) -> EndCardSettings:
    return await _attach_asset(
        db,
        project_id,
        original_filename=original_filename,
        content_type=content_type,
        chunks=chunks,
        field="logo_filename",
        stem="end-card-logo",
        extensions=LOGO_EXTENSIONS,
        mime_types=LOGO_MIME_TYPES,
    )


async def attach_music(
    db: Session,
    project_id: UUID,
    *,
    original_filename: str | None,
    content_type: str | None,
    chunks: AsyncIterator[bytes],
) -> EndCardSettings:
    """Store the user's own music. Nothing is ever fetched from the internet."""
    return await _attach_asset(
        db,
        project_id,
        original_filename=original_filename,
        content_type=content_type,
        chunks=chunks,
        field="music_filename",
        stem="end-card-music",
        extensions=MUSIC_EXTENSIONS,
        mime_types=MUSIC_MIME_TYPES,
    )


def reset_project_settings(db: Session, project_id: UUID) -> None:
    """Drop the project override so the global config applies again."""
    row = get_project_settings(db, project_id)
    if row is not None:
        db.delete(row)
        db.commit()


def build_content(
    project: Project,
    config: ResolvedEndCard,
) -> EndCardContent:
    """Assemble the printable content from the project and the resolved config."""
    cover_path: Path | None = None
    if project.cover_filename:
        candidate = storage.resolve_inside_project(project.id, project.cover_filename)
        cover_path = candidate if candidate.is_file() else None

    logo_path: Path | None = None
    if config.logo_filename:
        candidate = storage.resolve_inside_project(project.id, config.logo_filename)
        logo_path = candidate if candidate.is_file() else None

    qr_url = None
    if config.show_qr:
        qr_url = config.qr_url or project.full_sermon_url

    return EndCardContent(
        sermon_title=project.title,
        church_name=project.church_name,
        channel_handle=config.channel_handle or project.youtube_channel,
        call_to_action=config.custom_message or CALL_TO_ACTION_TEXT,
        url_text=config.url_text or project.full_sermon_url,
        cover_path=cover_path,
        logo_path=logo_path,
        qr_url=qr_url,
    )
