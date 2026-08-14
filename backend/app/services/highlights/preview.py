"""Build a short, seekable MP4 that contains only selected highlight clips."""

from __future__ import annotations

import hashlib
import json
import shutil
import threading
from pathlib import Path
from uuid import UUID

from app.core.exceptions import AppError, NotFoundError, ValidationAppError
from app.services import storage
from app.services.render.binary import locate_ffmpeg
from app.services.render.runner import FFmpegError, run_ffmpeg

_PREVIEW_NAME = "highlights-preview.mp4"
_PREVIEW_META = "highlights-preview.json"


def clip_identity(clips: list[tuple[float, float]]) -> str:
    payload = [(round(start, 3), round(end, 3)) for start, end in clips]
    return hashlib.sha1(json.dumps(payload, separators=(",", ":")).encode("utf-8")).hexdigest()[:16]


def ensure_highlights_preview(
    project_id: UUID,
    video_filename: str,
    clips: list[tuple[float, float]],
) -> Path:
    cleaned = [(float(start), float(end)) for start, end in clips if end - start >= 0.08]
    if len(cleaned) < 1:
        raise ValidationAppError(
            "No hay fragmentos válidos para el preview.",
            code="highlight_preview_empty",
        )
    if not video_filename:
        raise NotFoundError("Project has no video.", code="video_not_found")
    source = storage.resolve_inside_project(project_id, video_filename)
    if not source.is_file():
        raise NotFoundError("Video file is missing on disk.", code="video_not_found")

    project_dir = storage.ensure_project_dir(project_id)
    destination = project_dir / _PREVIEW_NAME
    meta_path = project_dir / _PREVIEW_META
    identity = clip_identity(cleaned)
    source_mtime = int(source.stat().st_mtime)
    if destination.is_file() and destination.stat().st_size > 2048 and meta_path.is_file():
        try:
            saved = json.loads(meta_path.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            saved = {}
        if (
            saved.get("identity") == identity
            and saved.get("source") == video_filename
            and saved.get("source_mtime") == source_mtime
        ):
            return destination

    ffmpeg = locate_ffmpeg() or shutil.which("ffmpeg")
    if ffmpeg is None:
        raise AppError("FFmpeg is not available.", code="ffmpeg_missing", status_code=503)

    temp = destination.with_name(f"{destination.stem}.building.mp4")
    log_path = project_dir / "highlights-preview.log"
    args = [ffmpeg, "-y", "-hide_banner"]
    for start, end in cleaned:
        args.extend(
            [
                "-ss",
                f"{start:.3f}",
                "-t",
                f"{max(0.08, end - start):.3f}",
                "-i",
                str(source),
            ]
        )
    count = len(cleaned)
    video_audio = "".join(
        f"[{index}:v]scale=1280:720:force_original_aspect_ratio=decrease,"
        f"pad=1280:720:(ow-iw)/2:(oh-ih)/2,fps=30,format=yuv420p,setsar=1[v{index}];"
        f"[{index}:a]aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo[a{index}];"
        for index in range(count)
    )
    concat_inputs = "".join(f"[v{index}][a{index}]" for index in range(count))
    args.extend(
        [
            "-filter_complex",
            f"{video_audio}{concat_inputs}concat=n={count}:v=1:a=1[v][a]",
            "-map",
            "[v]",
            "-map",
            "[a]",
            "-c:v",
            "libx264",
            "-preset",
            "veryfast",
            "-crf",
            "28",
            "-c:a",
            "aac",
            "-b:a",
            "160k",
            "-movflags",
            "+faststart",
            "-progress",
            "pipe:1",
            "-nostats",
            "-f",
            "mp4",
            str(temp),
        ]
    )
    try:
        result = run_ffmpeg(args, cancel_event=threading.Event(), log_path=log_path)
        if result.cancelled:
            raise AppError("Highlight preview was cancelled.", code="highlight_preview_cancelled")
        if not temp.is_file() or temp.stat().st_size < 2048:
            raise AppError(
                "FFmpeg produced an empty highlight preview.",
                code="highlight_preview_empty",
            )
        temp.replace(destination)
        meta_path.write_text(
            json.dumps(
                {
                    "identity": identity,
                    "source": video_filename,
                    "source_mtime": source_mtime,
                },
                separators=(",", ":"),
            ),
            encoding="utf-8",
        )
    except FFmpegError as exc:
        temp.unlink(missing_ok=True)
        raise AppError(
            f"No se pudo crear el preview de Highlights: {exc}",
            code="highlight_preview_failed",
            status_code=502,
        ) from exc
    except Exception:
        temp.unlink(missing_ok=True)
        raise
    return destination


def current_preview_path(project_id: UUID) -> Path:
    path = storage.resolve_inside_project(project_id, _PREVIEW_NAME)
    if not path.is_file() or path.stat().st_size < 2048:
        raise NotFoundError("Highlight preview is not ready.", code="highlight_preview_missing")
    return path
