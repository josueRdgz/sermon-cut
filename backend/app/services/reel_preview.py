"""On-demand assembled MP4 preview for a Reel (transitions + overlays)."""

from __future__ import annotations

import hashlib
import json
import shutil
import threading
from pathlib import Path
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.core.exceptions import AppError, NotFoundError, ValidationAppError
from app.models.project import Project
from app.models.project_asset import ProjectAsset
from app.models.reel import Reel
from app.models.reel_overlay import ReelOverlayKind
from app.services import storage
from app.services.ffprobe import probe_video
from app.services.overlays import list_overlays_for_render
from app.services.overlays_render import render_title_card
from app.services.render.args import OverlaySpec, RenderSegmentSpec, build_render_command
from app.services.render.binary import locate_ffmpeg
from app.services.render.runner import FFmpegError, run_ffmpeg

_PREVIEW_NAME = "reel-assembled-preview.mp4"
_PREVIEW_META = "reel-assembled-preview.json"


def _identity(reel: Reel, overlay_rows: list) -> str:
    payload = {
        "segments": [
            [
                round(s.source_start_seconds, 3),
                round(s.source_end_seconds, 3),
                s.transition_type.value,
                s.transition_duration_ms,
            ]
            for s in sorted(reel.segments, key=lambda item: item.order)
        ],
        "overlays": [
            [
                o.kind.value,
                str(o.asset_id) if o.asset_id else None,
                (o.text or "")[:80],
                o.start_ms,
                o.duration_ms,
                round(o.x, 3),
                round(o.y, 3),
                round(o.scale, 3),
                round(o.opacity, 3),
            ]
            for o in overlay_rows
        ],
        "aspect": reel.aspect_ratio.value,
        "audio_offset_ms": getattr(reel, "audio_offset_ms", 0) or 0,
    }
    return hashlib.sha1(json.dumps(payload, separators=(",", ":")).encode("utf-8")).hexdigest()[:16]


def ensure_reel_assembled_preview(
    db: Session,
    project_id: UUID,
    reel_id: UUID,
) -> Path:
    project = db.get(Project, project_id)
    if project is None or not project.video_filename:
        raise NotFoundError("Project has no video.", code="video_not_found")

    reel = db.scalars(
        select(Reel).where(Reel.id == reel_id).options(selectinload(Reel.segments))
    ).first()
    if reel is None or reel.project_id != project_id:
        raise NotFoundError("Reel not found.", code="reel_not_found")
    if not reel.segments:
        raise ValidationAppError("The reel has no segments.", code="reel_empty")

    source = storage.resolve_inside_project(project_id, project.video_filename)
    if not source.is_file():
        raise NotFoundError("Video file is missing on disk.", code="video_not_found")

    overlay_rows = list_overlays_for_render(db, reel_id)
    identity = _identity(reel, overlay_rows)
    project_path = storage.ensure_project_dir(project_id)
    destination = project_path / _PREVIEW_NAME
    meta_path = project_path / _PREVIEW_META
    source_mtime = int(source.stat().st_mtime)
    if destination.is_file() and destination.stat().st_size > 2048 and meta_path.is_file():
        try:
            saved = json.loads(meta_path.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            saved = {}
        if (
            saved.get("identity") == identity
            and saved.get("source") == project.video_filename
            and saved.get("source_mtime") == source_mtime
            and saved.get("reel_id") == str(reel_id)
        ):
            return destination

    ffmpeg = locate_ffmpeg() or shutil.which("ffmpeg")
    if ffmpeg is None:
        raise AppError("FFmpeg is not available.", code="ffmpeg_missing", status_code=503)

    metadata = probe_video(source)
    has_audio = bool(getattr(metadata, "audio_codec", None))
    segments = [
        RenderSegmentSpec(
            start=item.source_start_seconds,
            end=item.source_end_seconds,
            transition_type=item.transition_type.value,
            transition_duration_ms=item.transition_duration_ms,
        )
        for item in sorted(reel.segments, key=lambda s: s.order)
    ]

    temp_dir = project_path / "preview-temp"
    temp_dir.mkdir(parents=True, exist_ok=True)
    overlay_specs: list[OverlaySpec] = []
    for index, row in enumerate(overlay_rows):
        path: Path | None = None
        if row.kind == ReelOverlayKind.image and row.asset_id is not None:
            asset = db.get(ProjectAsset, row.asset_id)
            if asset is not None:
                candidate = storage.resolve_inside_project(project_id, asset.storage_path)
                if candidate.is_file():
                    path = candidate
        elif row.kind == ReelOverlayKind.text:
            title_path = temp_dir / f"title-{index}.png"
            render_title_card(row.text or "", title_path)
            path = title_path
        if path is None:
            continue
        overlay_specs.append(
            OverlaySpec(
                path=path,
                start_seconds=max(0.0, row.start_ms / 1000.0),
                duration_seconds=max(0.2, row.duration_ms / 1000.0),
                x=row.x,
                y=row.y,
                scale=row.scale,
                opacity=row.opacity,
            )
        )

    temp = destination.with_name(f"{destination.stem}.building.mp4")
    log_path = project_path / "reel-assembled-preview.log"
    plan = build_render_command(
        ffmpeg=ffmpeg,
        source=source,
        segments=segments,
        aspect_ratio=reel.aspect_ratio.value,
        layout=getattr(reel, "framing_mode", None) or "center_crop",
        output_path=temp,
        has_audio=has_audio,
        fps=getattr(metadata, "fps", None),
        normalize_loudness=False,
        crf=28,
        preset="veryfast",
        audio_bitrate_k=160,
        end_card=None,
        background_music=None,
        audio_offset_ms=getattr(reel, "audio_offset_ms", 0) or 0,
        overlays=overlay_specs or None,
    )
    args = list(plan.args)
    if "-y" not in args:
        args.insert(1, "-y")

    try:
        result = run_ffmpeg(args, cancel_event=threading.Event(), log_path=log_path)
        if result.cancelled:
            raise AppError("Reel preview was cancelled.", code="reel_preview_cancelled")
        if not temp.is_file() or temp.stat().st_size < 2048:
            raise AppError(
                "FFmpeg produced an empty reel preview.",
                code="reel_preview_empty",
            )
        temp.replace(destination)
        meta_path.write_text(
            json.dumps(
                {
                    "identity": identity,
                    "source": project.video_filename,
                    "source_mtime": source_mtime,
                    "reel_id": str(reel_id),
                },
                separators=(",", ":"),
            ),
            encoding="utf-8",
        )
    except FFmpegError as exc:
        temp.unlink(missing_ok=True)
        raise AppError(
            f"No se pudo crear el preview ensamblado: {exc}",
            code="reel_preview_failed",
            status_code=502,
        ) from exc
    except Exception:
        temp.unlink(missing_ok=True)
        raise
    return destination


def current_reel_preview_path(project_id: UUID) -> Path:
    path = storage.resolve_inside_project(project_id, _PREVIEW_NAME)
    if not path.is_file() or path.stat().st_size < 2048:
        raise NotFoundError("Reel assembled preview is not ready.", code="reel_preview_missing")
    return path
