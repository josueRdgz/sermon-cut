"""Centralized filesystem paths built with pathlib.

Paths can be overridden with ``SERMON_CUT_STORAGE_DIR`` (environment) or by
calling ``configure_paths`` after settings load. Defaults live under
``<repo>/storage``.
"""

from __future__ import annotations

import os
from pathlib import Path
from uuid import UUID

# .../backend/app/core/paths.py -> parents: [core, app, backend, <repo root>]
BACKEND_DIR: Path = Path(__file__).resolve().parents[2]
ROOT_DIR: Path = BACKEND_DIR.parent


def _default_storage_dir() -> Path:
    override = os.environ.get("SERMON_CUT_STORAGE_DIR", "").strip()
    if override:
        return Path(override).expanduser().resolve()
    return (ROOT_DIR / "storage").resolve()


STORAGE_DIR: Path = _default_storage_dir()
PROJECTS_DIR: Path = STORAGE_DIR / "projects"
TEMP_DIR: Path = STORAGE_DIR / "temp"
EXPORTS_DIR: Path = STORAGE_DIR / "exports"
DATABASE_FILE: Path = STORAGE_DIR / "sermon_cut.db"
WHISPER_CACHE_DIR: Path = STORAGE_DIR / "whisper-models"

_MANAGED_DIRS: tuple[Path, ...] = (
    STORAGE_DIR,
    PROJECTS_DIR,
    TEMP_DIR,
    EXPORTS_DIR,
    WHISPER_CACHE_DIR,
)


def configure_paths(storage_dir: str | Path | None = None) -> Path:
    """Rebind storage roots (call once at startup when settings override the env)."""
    global STORAGE_DIR, PROJECTS_DIR, TEMP_DIR, EXPORTS_DIR, DATABASE_FILE, WHISPER_CACHE_DIR
    global _MANAGED_DIRS

    if storage_dir is not None and str(storage_dir).strip():
        root = Path(storage_dir).expanduser().resolve()
    else:
        root = _default_storage_dir()

    STORAGE_DIR = root
    PROJECTS_DIR = STORAGE_DIR / "projects"
    TEMP_DIR = STORAGE_DIR / "temp"
    EXPORTS_DIR = STORAGE_DIR / "exports"
    DATABASE_FILE = STORAGE_DIR / "sermon_cut.db"
    WHISPER_CACHE_DIR = STORAGE_DIR / "whisper-models"
    _MANAGED_DIRS = (
        STORAGE_DIR,
        PROJECTS_DIR,
        TEMP_DIR,
        EXPORTS_DIR,
        WHISPER_CACHE_DIR,
    )
    return STORAGE_DIR


def ensure_storage_dirs() -> None:
    """Create the storage directory tree if it does not exist yet."""
    for directory in _MANAGED_DIRS:
        directory.mkdir(parents=True, exist_ok=True)


def default_database_url() -> str:
    """Return the SQLite URL for the default on-disk database."""
    return f"sqlite:///{DATABASE_FILE.as_posix()}"


def project_dir(project_id: UUID) -> Path:
    """Return the on-disk directory for a given project UUID."""
    return PROJECTS_DIR / str(project_id)


def job_temp_dir(job_id: UUID) -> Path:
    """Return the temp working directory for a transcription job."""
    return TEMP_DIR / f"transcription-{job_id}"


def project_source_dir(project_id: UUID) -> Path:
    """Scratch directory for downloaded sources (yt-dlp .part files, streams)."""
    return project_dir(project_id) / "source"


def project_renders_dir(project_id: UUID) -> Path:
    """Return the directory holding rendered reels for a project."""
    return project_dir(project_id) / "renders"


def project_render_temp_dir(project_id: UUID) -> Path:
    """Temp working directory for renders, kept inside the project folder."""
    return project_dir(project_id) / "renders" / ".tmp"
