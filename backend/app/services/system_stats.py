"""Lightweight local system stats for the home screen (storage + optional tools).

Everything here is cheap and read-only. Disk usage walks only the projects tree
and sums file sizes (metadata stat calls), which is fast for local libraries.
"""

from __future__ import annotations

from dataclasses import dataclass
from importlib import metadata

from app.core.config import Settings
from app.core.paths import PROJECTS_DIR


@dataclass(frozen=True)
class ToolAvailability:
    available: bool
    version: str | None = None


@dataclass(frozen=True)
class StorageUsage:
    bytes_used: int
    project_count: int


def _pkg_version(name: str) -> str | None:
    try:
        return metadata.version(name)
    except metadata.PackageNotFoundError:
        return None


def whisper_status() -> ToolAvailability:
    """Report whether local transcription (faster-whisper) is installed."""
    version = _pkg_version("faster-whisper")
    return ToolAvailability(available=version is not None, version=version)


def gemini_status(settings: Settings) -> ToolAvailability:
    """Report whether optional Gemini analysis is configured (never the key)."""
    configured = bool(settings.gemini_api_key) and settings.ai_provider != "mock"
    return ToolAvailability(
        available=configured,
        version=settings.gemini_model if configured else None,
    )


def storage_usage() -> StorageUsage:
    """Sum bytes stored under the projects tree and count project folders."""
    total = 0
    projects = 0
    if PROJECTS_DIR.exists():
        for entry in PROJECTS_DIR.iterdir():
            if not entry.is_dir():
                continue
            projects += 1
            for path in entry.rglob("*"):
                try:
                    if path.is_file():
                        total += path.stat().st_size
                except OSError:
                    continue
    return StorageUsage(bytes_used=total, project_count=projects)
