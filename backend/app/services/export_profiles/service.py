"""CRUD + seed for editable export profiles."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime
from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.exceptions import NotFoundError, ValidationAppError
from app.models.export_profile import ExportProfile, ExportQuality, FpsMode
from app.models.project import Project
from app.models.reel import Reel
from app.schemas.export_profile import ExportProfileUpdate
from app.services.export_profiles.defaults import BUILTIN_PROFILES
from app.services.export_profiles.estimate import (
    SizeEstimate,
    audio_bitrate_for,
    crf_for,
    encode_preset_for,
    estimate_size,
)


@dataclass(frozen=True)
class ResolvedEncode:
    profile: ExportProfile
    quality: ExportQuality
    crf: int
    encode_preset: str
    audio_bitrate_k: int
    fps_override: float | None
    subtitle_margin_bottom: int


def _utc_now() -> datetime:
    return datetime.now(UTC)


def ensure_builtin_profiles(db: Session) -> list[ExportProfile]:
    """Insert missing built-in profiles (idempotent)."""
    existing = {
        row.slug: row
        for row in db.scalars(select(ExportProfile).where(ExportProfile.is_builtin.is_(True))).all()
    }
    created: list[ExportProfile] = []
    for spec in BUILTIN_PROFILES:
        if spec["slug"] in existing:
            continue
        row = ExportProfile(
            slug=spec["slug"],
            name=spec["name"],
            description=spec.get("description"),
            platform=spec["platform"],
            width=spec["width"],
            height=spec["height"],
            aspect_ratio=spec["aspect_ratio"],
            video_codec="libx264",
            audio_codec="aac",
            max_duration_seconds=spec["max_duration_seconds"],
            fps_mode=spec["fps_mode"],
            safe_margin_x=spec["safe_margin_x"],
            safe_top=spec["safe_top"],
            safe_bottom=spec["safe_bottom"],
            crf_draft=spec["crf_draft"],
            crf_standard=spec["crf_standard"],
            crf_high=spec["crf_high"],
            preset_draft=spec.get("preset_draft", "veryfast"),
            preset_standard=spec.get("preset_standard", "medium"),
            preset_high=spec.get("preset_high", "slow"),
            audio_bitrate_draft_k=spec.get("audio_bitrate_draft_k", 128),
            audio_bitrate_standard_k=spec.get("audio_bitrate_standard_k", 160),
            audio_bitrate_high_k=spec.get("audio_bitrate_high_k", 192),
            fragmentation_enabled=bool(spec.get("fragmentation_enabled", False)),
            fragment_max_seconds=spec.get("fragment_max_seconds"),
            prefer_small_file=bool(spec.get("prefer_small_file", False)),
            is_builtin=True,
            is_active=True,
            created_at=_utc_now(),
            updated_at=_utc_now(),
        )
        db.add(row)
        created.append(row)
    if created:
        db.commit()
        for row in created:
            db.refresh(row)
    return list(
        db.scalars(
            select(ExportProfile).where(ExportProfile.is_active.is_(True)).order_by(ExportProfile.name)
        ).all()
    )


def list_profiles(db: Session, *, active_only: bool = True) -> list[ExportProfile]:
    ensure_builtin_profiles(db)
    stmt = select(ExportProfile).order_by(ExportProfile.name)
    if active_only:
        stmt = stmt.where(ExportProfile.is_active.is_(True))
    return list(db.scalars(stmt).all())


def get_profile(db: Session, profile_id: UUID) -> ExportProfile:
    ensure_builtin_profiles(db)
    row = db.get(ExportProfile, profile_id)
    if row is None:
        raise NotFoundError("Export profile not found.", code="export_profile_not_found")
    return row


def get_profile_by_slug(db: Session, slug: str) -> ExportProfile:
    ensure_builtin_profiles(db)
    row = db.scalars(select(ExportProfile).where(ExportProfile.slug == slug)).first()
    if row is None:
        raise NotFoundError("Export profile not found.", code="export_profile_not_found")
    return row


def update_profile(
    db: Session, profile_id: UUID, payload: ExportProfileUpdate
) -> ExportProfile:
    row = get_profile(db, profile_id)
    data = payload.model_dump(exclude_unset=True)
    if "max_duration_seconds" in data and data["max_duration_seconds"] is not None:
        # YouTube Shorts: allow 60 or 180 (and values in between for custom).
        value = int(data["max_duration_seconds"])
        if value < 5 or value > 3600:
            raise ValidationAppError(
                "max_duration_seconds must be between 5 and 3600.",
                code="invalid_max_duration",
            )
    if "fps_mode" in data and data["fps_mode"] is not None:
        data["fps_mode"] = FpsMode(data["fps_mode"])
    for key, value in data.items():
        setattr(row, key, value)
    row.updated_at = _utc_now()
    db.commit()
    db.refresh(row)
    return row


def resolve_encode(
    profile: ExportProfile,
    quality: ExportQuality,
    *,
    crf_override: int | None = None,
) -> ResolvedEncode:
    crf = crf_override if crf_override is not None else crf_for(profile, quality)
    crf = max(14, min(32, crf))
    margin = int(round(profile.height * profile.safe_bottom))
    margin = max(48, min(400, margin))
    fps_override = 30.0 if profile.fps_mode == FpsMode.fixed_30 else None
    return ResolvedEncode(
        profile=profile,
        quality=quality,
        crf=crf,
        encode_preset=encode_preset_for(profile, quality),
        audio_bitrate_k=audio_bitrate_for(profile, quality),
        fps_override=fps_override,
        subtitle_margin_bottom=margin,
    )


def clip_index_for_reel(db: Session, project_id: UUID, reel_id: UUID) -> int:
    """1-based index of the reel among the project's reels (by creation time)."""
    reels = list(
        db.scalars(
            select(Reel)
            .where(Reel.project_id == project_id)
            .order_by(Reel.created_at.asc(), Reel.id.asc())
        ).all()
    )
    for index, reel in enumerate(reels, start=1):
        if reel.id == reel_id:
            return index
    return 1


def estimate_for_reel(
    db: Session,
    project_id: UUID,
    reel_id: UUID,
    *,
    profile_id: UUID,
    quality: ExportQuality,
    crf: int | None = None,
) -> SizeEstimate:
    from app.services.reels import service as reels_service

    project = db.get(Project, project_id)
    if project is None:
        raise NotFoundError("Project not found.", code="project_not_found")
    reel = reels_service.get_reel_for_project(db, project_id, reel_id)
    profile = get_profile(db, profile_id)
    duration = sum(
        max(0.0, seg.source_end_seconds - seg.source_start_seconds) for seg in reel.segments
    )
    # End card typically ~5s — include a modest pad for the estimate.
    duration += 5.0
    fps = float(project.fps or 30.0)
    encode = resolve_encode(profile, quality, crf_override=crf)
    if encode.fps_override is not None:
        fps = encode.fps_override
    return estimate_size(
        profile=profile,
        quality=quality,
        duration_seconds=duration,
        fps=fps,
        crf=encode.crf,
        audio_bitrate_k=encode.audio_bitrate_k,
    )


def assert_duration_allowed(profile: ExportProfile, duration_seconds: float) -> None:
    if duration_seconds > profile.max_duration_seconds + 0.5:
        raise ValidationAppError(
            (
                f"El Reel (~{duration_seconds:.0f}s) supera el máximo del perfil "
                f"({profile.max_duration_seconds}s). Acorta el contenido o edita el perfil "
                f"(p. ej. YouTube Shorts hasta 180s)."
            ),
            code="export_duration_exceeded",
        )
    if (
        profile.fragmentation_enabled
        and profile.fragment_max_seconds
        and duration_seconds > profile.fragment_max_seconds + 0.5
    ):
        # Soft guidance: still allow render but callers may surface the note.
        return


def fragmentation_note(profile: ExportProfile, duration_seconds: float) -> str | None:
    if not profile.fragmentation_enabled or not profile.fragment_max_seconds:
        return None
    if duration_seconds <= profile.fragment_max_seconds:
        return None
    return (
        f"Duración ~{duration_seconds:.0f}s supera el fragmento sugerido "
        f"({profile.fragment_max_seconds}s). Considera dividir el Reel en varios estados."
    )


def default_profile(db: Session) -> ExportProfile:
    ensure_builtin_profiles(db)
    row = db.scalars(
        select(ExportProfile).where(ExportProfile.slug == "youtube-short")
    ).first()
    if row is not None:
        return row
    rows = list_profiles(db)
    if not rows:
        raise NotFoundError("No export profiles available.", code="export_profile_not_found")
    return rows[0]


def default_highlight_profile(db: Session) -> ExportProfile:
    """Return the horizontal profile reserved for Video Highlights."""
    return get_profile_by_slug(db, "youtube-highlight")


def profile_count(db: Session) -> int:
    return int(db.scalar(select(func.count()).select_from(ExportProfile)) or 0)
