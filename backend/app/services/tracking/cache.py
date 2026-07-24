"""On-disk cache for subject-tracking results (per project / reel)."""

from __future__ import annotations

import json
from pathlib import Path
from uuid import UUID

from app.core.paths import project_dir
from app.services.tracking.types import NormalizedPoint


def tracking_dir(project_id: UUID) -> Path:
    path = project_dir(project_id) / "tracking"
    path.mkdir(parents=True, exist_ok=True)
    return path


def cache_path(project_id: UUID, reel_id: UUID) -> Path:
    return tracking_dir(project_id) / f"{reel_id}.json"


def preview_dir(project_id: UUID, reel_id: UUID) -> Path:
    path = tracking_dir(project_id) / f"{reel_id}-preview"
    path.mkdir(parents=True, exist_ok=True)
    return path


def load_cache(project_id: UUID, reel_id: UUID) -> dict | None:
    path = cache_path(project_id, reel_id)
    if not path.is_file():
        return None
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return None


def save_cache(project_id: UUID, reel_id: UUID, payload: dict) -> Path:
    path = cache_path(project_id, reel_id)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    return path


def clear_cache(project_id: UUID, reel_id: UUID) -> bool:
    removed = False
    path = cache_path(project_id, reel_id)
    if path.is_file():
        path.unlink()
        removed = True
    preview = tracking_dir(project_id) / f"{reel_id}-preview"
    if preview.is_dir():
        for child in preview.iterdir():
            child.unlink(missing_ok=True)
        preview.rmdir()
        removed = True
    return removed


def points_from_cache_segment(raw: dict) -> list[NormalizedPoint]:
    points: list[NormalizedPoint] = []
    for item in raw.get("points", []):
        points.append(
            NormalizedPoint(
                time=float(item["time"]),
                x=float(item["x"]),
                y=float(item["y"]),
                confidence=float(item.get("confidence", 1.0)),
                stable=bool(item.get("stable", True)),
            )
        )
    return points
