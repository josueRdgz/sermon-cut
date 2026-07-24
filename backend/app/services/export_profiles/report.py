"""JSON render report written next to the MP4 (local only — no auto-publish)."""

from __future__ import annotations

import hashlib
import json
from datetime import UTC, datetime
from pathlib import Path
from typing import Any
from uuid import UUID


def sha256_file(path: Path, *, chunk_size: int = 1024 * 1024) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        while True:
            chunk = handle.read(chunk_size)
            if not chunk:
                break
            digest.update(chunk)
    return digest.hexdigest()


def build_render_report(
    *,
    job_id: UUID,
    project_id: UUID,
    reel_id: UUID,
    profile_slug: str | None,
    profile_name: str | None,
    quality: str | None,
    status: str,
    output_filename: str,
    output_path: Path,
    sha256: str,
    duration_seconds: float | None,
    width: int | None,
    height: int | None,
    fps: float | None,
    size_bytes: int,
    crf: int | None,
    encode_preset: str | None,
    audio_bitrate_k: int | None,
    verified: bool,
    verify_errors: list[str] | None = None,
    ffmpeg_command: str | None = None,
    created_at: datetime | None = None,
    finished_at: datetime | None = None,
    extra: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Structured metadata for one local export (never published automatically)."""
    payload: dict[str, Any] = {
        "schema_version": 1,
        "job_id": str(job_id),
        "project_id": str(project_id),
        "reel_id": str(reel_id),
        "status": status,
        "publish_status": "local_only",
        "auto_published": False,
        "profile": {
            "slug": profile_slug,
            "name": profile_name,
            "quality": quality,
        },
        "output": {
            "filename": output_filename,
            # Basename only — never leak absolute paths / usernames in shared reports.
            "path": output_filename,
            "sha256": sha256,
            "size_bytes": size_bytes,
            "duration_seconds": duration_seconds,
            "width": width,
            "height": height,
            "fps": fps,
            "video_codec": "h264",
            "audio_codec": "aac",
        },
        "encode": {
            "crf": crf,
            "preset": encode_preset,
            "audio_bitrate_k": audio_bitrate_k,
        },
        "verification": {
            "ok": verified,
            "tool": "ffprobe",
            "errors": verify_errors or [],
        },
        "timestamps": {
            "created_at": (created_at or datetime.now(UTC)).isoformat(),
            "finished_at": (finished_at or datetime.now(UTC)).isoformat(),
        },
    }
    if ffmpeg_command:
        from app.services.storage import redact_local_paths

        payload["ffmpeg_command"] = redact_local_paths(ffmpeg_command)[:4000]
    if extra:
        payload["extra"] = extra
    return payload


def write_render_report(path: Path, report: dict[str, Any]) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return path
