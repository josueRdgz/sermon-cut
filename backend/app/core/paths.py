"""Centralized filesystem paths built with pathlib.

Every path in the project is derived from this module so we never concatenate
path strings by hand. The target platform is macOS.
"""

from __future__ import annotations

from pathlib import Path
from uuid import UUID

# .../backend/app/core/paths.py -> parents: [core, app, backend, <repo root>]
BACKEND_DIR: Path = Path(__file__).resolve().parents[2]
ROOT_DIR: Path = BACKEND_DIR.parent

STORAGE_DIR: Path = ROOT_DIR / "storage"
PROJECTS_DIR: Path = STORAGE_DIR / "projects"
TEMP_DIR: Path = STORAGE_DIR / "temp"
EXPORTS_DIR: Path = STORAGE_DIR / "exports"

DATABASE_FILE: Path = STORAGE_DIR / "sermon_cut.db"

_MANAGED_DIRS: tuple[Path, ...] = (STORAGE_DIR, PROJECTS_DIR, TEMP_DIR, EXPORTS_DIR)


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
