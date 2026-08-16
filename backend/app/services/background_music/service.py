"""CRUD, upload and resolve optional local background music."""

from __future__ import annotations

from collections.abc import AsyncIterator
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.exceptions import AppError, NotFoundError, ValidationAppError
from app.models.background_music import (
    RIGHTS_WARNING,
    BackgroundMusicPreset,
    BackgroundMusicScope,
    BackgroundMusicSettings,
)
from app.models.project import Project
from app.schemas.background_music import (
    BackgroundMusicMetersResponse,
    BackgroundMusicPresetInfo,
    BackgroundMusicResponse,
    BackgroundMusicUpdate,
)
from app.services import storage
from app.services.background_music.ffmpeg_filters import (
    PRESET_VALUES,
    BackgroundMusicSpec,
    volume_to_db,
)
from app.services.ffprobe import probe_video

MUSIC_EXTENSIONS = frozenset({".mp3", ".wav", ".m4a", ".ogg"})
MUSIC_MIME_TYPES = frozenset(
    {
        "audio/mpeg",
        "audio/mp3",
        "audio/wav",
        "audio/x-wav",
        "audio/wave",
        "audio/mp4",
        "audio/m4a",
        "audio/x-m4a",
        "audio/ogg",
        "application/ogg",
    }
)
MUSIC_STEM = "background-music"

_PRESET_INFO: tuple[BackgroundMusicPresetInfo, ...] = (
    BackgroundMusicPresetInfo(
        id=BackgroundMusicPreset.none,
        label="Ninguna",
        description="Sin música de fondo (predeterminado).",
    ),
    BackgroundMusicPresetInfo(
        id=BackgroundMusicPreset.very_soft_background,
        label="Fondo muy suave",
        description="Bed bajo durante todo el Reel con ducking ante la voz.",
    ),
)


def list_presets() -> list[BackgroundMusicPresetInfo]:
    return list(_PRESET_INFO)


def get_settings_row(db: Session, project_id: UUID) -> BackgroundMusicSettings | None:
    return db.scalars(
        select(BackgroundMusicSettings).where(BackgroundMusicSettings.project_id == project_id)
    ).first()


def ensure_row(db: Session, project_id: UUID) -> BackgroundMusicSettings:
    projects = db.get(Project, project_id)
    if projects is None:
        raise NotFoundError("Project not found.", code="project_not_found")
    row = get_settings_row(db, project_id)
    if row is not None:
        return row
    settings = get_settings()
    row = BackgroundMusicSettings(
        project_id=project_id,
        preset=BackgroundMusicPreset.none,
        scope=BackgroundMusicScope.full_reel,
        volume=0.0,
        start_seconds=0.0,
        fade_in_ms=0,
        fade_out_ms=0,
        ducking_enabled=False,
        target_lufs=settings.target_lufs,
        true_peak_db=settings.true_peak_db,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


def to_response(row: BackgroundMusicSettings | None) -> BackgroundMusicResponse:
    settings = get_settings()
    if row is None:
        return BackgroundMusicResponse(
            preset=BackgroundMusicPreset.none,
            scope=BackgroundMusicScope.full_reel,
            music_filename=None,
            volume=0.0,
            start_seconds=0.0,
            end_seconds=None,
            fade_in_ms=0,
            fade_out_ms=0,
            ducking_enabled=False,
            target_lufs=settings.target_lufs,
            true_peak_db=settings.true_peak_db,
            enabled=False,
            rights_warning=RIGHTS_WARNING,
        )
    enabled = (
        row.preset != BackgroundMusicPreset.none
        and bool(row.music_filename)
        and row.volume > 0
    )
    return BackgroundMusicResponse(
        preset=row.preset,
        scope=row.scope,
        music_filename=row.music_filename,
        volume=row.volume,
        start_seconds=row.start_seconds,
        end_seconds=row.end_seconds,
        fade_in_ms=row.fade_in_ms,
        fade_out_ms=row.fade_out_ms,
        ducking_enabled=row.ducking_enabled,
        target_lufs=row.target_lufs,
        true_peak_db=row.true_peak_db,
        enabled=enabled,
        rights_warning=RIGHTS_WARNING,
    )


def apply_preset(row: BackgroundMusicSettings, preset: BackgroundMusicPreset) -> None:
    values = PRESET_VALUES[preset]
    row.preset = preset
    row.scope = values["scope"]
    row.volume = float(values["volume"])
    row.fade_in_ms = int(values["fade_in_ms"])
    row.fade_out_ms = int(values["fade_out_ms"])
    row.ducking_enabled = bool(values["ducking_enabled"])
    row.target_lufs = float(values["target_lufs"])
    row.true_peak_db = float(values["true_peak_db"])


def update_settings(
    db: Session, project_id: UUID, payload: BackgroundMusicUpdate
) -> BackgroundMusicSettings:
    row = ensure_row(db, project_id)
    data = payload.model_dump(exclude_unset=True)
    clear_music = data.pop("clear_music", False)

    if "preset" in data and data["preset"] is not None:
        apply_preset(row, BackgroundMusicPreset(data["preset"]))
        data.pop("preset", None)

    if (
        "start_seconds" in data
        and "end_seconds" not in data
        and row.end_seconds is not None
        and row.end_seconds <= data["start_seconds"]
    ):
        # Moving the start beyond a previously selected end means “use the
        # remainder of the file” rather than retaining an impossible range.
        row.end_seconds = None

    for key, value in data.items():
        if key == "end_seconds" and value is not None and value <= row.start_seconds:
            raise ValidationAppError(
                "end_seconds must be greater than start_seconds.",
                code="invalid_music_range",
            )
        setattr(row, key, value)

    if clear_music:
        _delete_music_files(project_id, row.music_filename)
        row.music_filename = None

    # Selecting ``none`` disables the bed without deleting the file.
    if row.preset == BackgroundMusicPreset.none:
        row.volume = 0.0
        row.ducking_enabled = False

    db.commit()
    db.refresh(row)
    return row


async def attach_music(
    db: Session,
    project_id: UUID,
    *,
    original_filename: str | None,
    content_type: str | None,
    chunks: AsyncIterator[bytes],
) -> BackgroundMusicSettings:
    """Store the user's own file inside the project directory."""
    if db.get(Project, project_id) is None:
        raise NotFoundError("Project not found.", code="project_not_found")

    safe_name = storage.sanitize_filename(original_filename, fallback_stem=MUSIC_STEM)
    extension = storage.validate_extension(safe_name, MUSIC_EXTENSIONS)
    storage.validate_mime(content_type, MUSIC_MIME_TYPES)

    settings = get_settings()
    destination = storage.resolve_inside_project(project_id, f"{MUSIC_STEM}{extension}")
    for existing in MUSIC_EXTENSIONS:
        previous = storage.resolve_inside_project(project_id, f"{MUSIC_STEM}{existing}")
        if previous != destination and previous.is_file():
            previous.unlink(missing_ok=True)

    await storage.save_upload_stream(
        destination, chunks, max_bytes=settings.max_music_upload_bytes
    )
    storage.assert_file_magic(destination, kind="audio")

    row = ensure_row(db, project_id)
    row.music_filename = destination.name
    # Uploading while preset is none keeps music off until the user picks a preset.
    db.commit()
    db.refresh(row)
    return row


def resolve_spec(db: Session, project_id: UUID) -> BackgroundMusicSpec | None:
    """Return a render-ready spec, or ``None`` when music must stay off."""
    row = get_settings_row(db, project_id)
    if row is None or row.preset == BackgroundMusicPreset.none:
        return None
    if not row.music_filename or row.volume <= 0:
        return None
    path = storage.resolve_inside_project(project_id, row.music_filename)
    if not path.is_file():
        return None
    source_duration: float | None = None
    try:
        source_duration = probe_video(path).duration_seconds
    except AppError:
        source_duration = None
    return BackgroundMusicSpec(
        path=path,
        volume=max(0.0, min(1.0, row.volume)),
        start_seconds=max(0.0, row.start_seconds),
        end_seconds=row.end_seconds,
        fade_in_seconds=max(0.0, row.fade_in_ms) / 1000.0,
        fade_out_seconds=max(0.0, row.fade_out_ms) / 1000.0,
        scope=row.scope,
        ducking=bool(row.ducking_enabled and row.scope == BackgroundMusicScope.full_reel),
        target_lufs=row.target_lufs,
        true_peak_db=row.true_peak_db,
        source_duration_seconds=source_duration,
    )


def build_meters(db: Session, project_id: UUID) -> BackgroundMusicMetersResponse:
    row = get_settings_row(db, project_id)
    response = to_response(row)
    settings = get_settings()
    target = row.target_lufs if row is not None else settings.target_lufs
    true_peak = row.true_peak_db if row is not None else settings.true_peak_db
    volume = row.volume if row is not None else 0.0
    ducking = bool(row.ducking_enabled) if row is not None else False
    preset = row.preset if row is not None else BackgroundMusicPreset.none
    music_db = volume_to_db(volume) if response.enabled else -96.0
    # The slider gain is applied exactly once. Ducking adds a moderate estimated
    # reduction while speech is present; the source track's own loudness varies.
    under = music_db - (6.0 if ducking else 0.0)
    return BackgroundMusicMetersResponse(
        enabled=response.enabled,
        preset=preset,
        target_lufs=target,
        true_peak_db=true_peak,
        music_volume=volume,
        music_volume_db=round(music_db, 1),
        ducking_enabled=ducking and response.enabled,
        estimated_music_under_voice_db=under if response.enabled else 0.0,
        voice_priority_note=(
            "La música usa el volumen indicado una sola vez; el ducking la baja "
            "moderadamente mientras hay voz."
            if response.enabled
            else "Sin música de fondo (preset none)."
        ),
        normalize_note=(
            f"Loudnorm hacia {target:.1f} LUFS (TP {true_peak:.1f} dBTP) "
            "con limitador previo para evitar clipping."
        ),
        rights_warning=RIGHTS_WARNING,
        clipping_risk="Bajo — limitador + true-peak de loudnorm activos en la exportación.",
    )


def _delete_music_files(project_id: UUID, current: str | None) -> None:
    for existing in MUSIC_EXTENSIONS:
        path = storage.resolve_inside_project(project_id, f"{MUSIC_STEM}{existing}")
        if path.is_file():
            path.unlink(missing_ok=True)
    if current:
        extra = storage.resolve_inside_project(project_id, current)
        if extra.is_file():
            extra.unlink(missing_ok=True)
