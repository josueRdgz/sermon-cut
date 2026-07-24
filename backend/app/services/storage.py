"""Local filesystem storage for project media.

Files live under ``storage/projects/{project_uuid}/``. SQLite only stores the
relative file name — never binary blobs.
"""

from __future__ import annotations

import re
import shutil
from collections.abc import AsyncIterator
from pathlib import Path
from uuid import UUID

from app.core.exceptions import ValidationAppError
from app.core.paths import project_dir

# Allowed video formats (initial set).
VIDEO_EXTENSIONS: frozenset[str] = frozenset({".mp4", ".mov", ".mkv", ".webm"})
VIDEO_MIME_TYPES: frozenset[str] = frozenset(
    {
        "video/mp4",
        "video/quicktime",
        "video/x-matroska",
        "video/webm",
        "application/octet-stream",  # some browsers omit a precise MIME type
    }
)

COVER_EXTENSIONS: frozenset[str] = frozenset({".jpg", ".jpeg", ".png", ".webp"})
COVER_MIME_TYPES: frozenset[str] = frozenset(
    {
        "image/jpeg",
        "image/png",
        "image/webp",
        "application/octet-stream",
    }
)

_UNSAFE_CHARS = re.compile(r"[^A-Za-z0-9._-]+")


def sanitize_filename(original_name: str | None, *, fallback_stem: str) -> str:
    """Return a safe basename free of path separators and traversal segments.

    Only the final path component is kept. Characters outside
    ``[A-Za-z0-9._-]`` are replaced with ``_``. An empty result falls back to
    ``fallback_stem`` plus the original extension (if any).
    """
    raw = (original_name or "").strip()
    # Drop any directory components to block path traversal (../../etc/passwd).
    name = Path(raw).name
    if name in {"", ".", ".."}:
        return fallback_stem

    stem = Path(name).stem
    suffix = Path(name).suffix.lower()
    cleaned_stem = _UNSAFE_CHARS.sub("_", stem).strip("._") or fallback_stem
    return f"{cleaned_stem}{suffix}"


def ensure_project_dir(project_id: UUID) -> Path:
    """Create and return the project directory."""
    directory = project_dir(project_id)
    directory.mkdir(parents=True, exist_ok=True)
    return directory


def resolve_inside_project(project_id: UUID, filename: str) -> Path:
    """Resolve ``filename`` under the project dir, rejecting path traversal."""
    directory = ensure_project_dir(project_id).resolve()
    candidate = (directory / Path(filename).name).resolve()
    if not candidate.is_relative_to(directory):
        raise ValidationAppError("Invalid file path.", code="invalid_path")
    return candidate


def delete_project_dir(project_id: UUID) -> None:
    """Remove the project directory and all of its contents, if it exists."""
    directory = project_dir(project_id)
    if directory.exists():
        shutil.rmtree(directory)


def validate_extension(filename: str, allowed: frozenset[str]) -> str:
    """Return the lowercased extension or raise if it is not allowed."""
    extension = Path(filename).suffix.lower()
    if extension not in allowed:
        allowed_list = ", ".join(sorted(allowed))
        raise ValidationAppError(
            f"Unsupported file extension '{extension or '(none)'}'. Allowed: {allowed_list}.",
            code="unsupported_extension",
        )
    return extension


def validate_mime(content_type: str | None, allowed: frozenset[str]) -> None:
    """Raise if the declared MIME type is present and not allowed."""
    if not content_type:
        return
    # Strip parameters such as "; charset=binary".
    mime = content_type.split(";", maxsplit=1)[0].strip().lower()
    if mime not in allowed:
        raise ValidationAppError(
            f"Unsupported MIME type '{mime}'.",
            code="unsupported_mime",
        )


async def save_upload_stream(
    destination: Path,
    chunks: AsyncIterator[bytes],
    *,
    max_bytes: int,
) -> int:
    """Write an upload stream to ``destination``, enforcing a size limit.

    Returns the number of bytes written. On size overflow the partial file is
    deleted and a ``ValidationAppError`` is raised.
    """
    destination.parent.mkdir(parents=True, exist_ok=True)
    written = 0
    try:
        with destination.open("wb") as handle:
            async for chunk in chunks:
                written += len(chunk)
                if written > max_bytes:
                    raise ValidationAppError(
                        f"File exceeds the maximum upload size of {max_bytes} bytes.",
                        code="file_too_large",
                    )
                handle.write(chunk)
    except Exception:
        if destination.exists():
            destination.unlink(missing_ok=True)
        raise
    return written
