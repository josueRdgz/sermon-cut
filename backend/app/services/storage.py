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

from app.core import paths
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


def remove_project_dir_if_empty(project_id: UUID) -> bool:
    """Remove one project tree only when it contains no files or symlinks."""
    directory = project_dir(project_id)
    if not directory.is_dir() or directory.is_symlink():
        return False
    if any(path.is_file() or path.is_symlink() for path in directory.rglob("*")):
        return False
    shutil.rmtree(directory)
    return True


def remove_empty_project_subdirs(project_id: UUID) -> int:
    """Remove empty descendant directories, deepest first."""
    directory = project_dir(project_id)
    if not directory.is_dir() or directory.is_symlink():
        return 0
    removed = 0
    descendants = sorted(
        (path for path in directory.rglob("*") if path.is_dir() and not path.is_symlink()),
        key=lambda path: len(path.parts),
        reverse=True,
    )
    for candidate in descendants:
        try:
            candidate.rmdir()
            removed += 1
        except OSError:
            pass
    return removed


def prune_empty_project_dirs() -> int:
    """Remove UUID project trees containing directories only; return the count."""
    if not paths.PROJECTS_DIR.is_dir():
        return 0
    removed = 0
    for directory in paths.PROJECTS_DIR.iterdir():
        if not directory.is_dir() or directory.is_symlink():
            continue
        try:
            UUID(directory.name)
        except ValueError:
            continue
        remove_empty_project_subdirs(UUID(directory.name))
        if remove_project_dir_if_empty(UUID(directory.name)):
            removed += 1
    return removed


def delete_project_video_files(project_id: UUID) -> int:
    """Delete top-level source video files, leaving covers, audio and renders."""
    directory = project_dir(project_id)
    if not directory.is_dir():
        return 0
    removed = 0
    for candidate in directory.iterdir():
        if candidate.is_file() and candidate.suffix.lower() in VIDEO_EXTENSIONS:
            candidate.unlink(missing_ok=True)
            removed += 1
    remove_project_dir_if_empty(project_id)
    return removed


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


def assert_file_magic(path: Path, *, kind: str) -> None:
    """Reject uploads whose on-disk bytes do not match the declared media kind.

    ``kind`` is one of ``video``, ``image``, ``audio``. This is a cheap first
    bytes check — not a full container parse (FFprobe still validates video).
    """
    if not path.is_file():
        raise ValidationAppError("Uploaded file is missing.", code="file_missing")
    header = path.read_bytes()[:64]
    if not header:
        raise ValidationAppError("Uploaded file is empty.", code="file_empty")

    ok = False
    if kind == "image":
        ok = (
            header.startswith(b"\xff\xd8\xff")  # JPEG
            or header.startswith(b"\x89PNG\r\n\x1a\n")  # PNG
            or (header.startswith(b"RIFF") and header[8:12] == b"WEBP")
        )
    elif kind == "audio":
        ok = (
            header.startswith(b"ID3")
            or header[:2] in {b"\xff\xfb", b"\xff\xf3", b"\xff\xf2"}  # MPEG frame
            or (header.startswith(b"RIFF") and header[8:12] == b"WAVE")
            or header[4:8] == b"ftyp"  # M4A
            or header.startswith(b"OggS")
        )
    elif kind == "video":
        ok = (
            header[4:8] == b"ftyp"  # MP4 / MOV
            or header.startswith(b"\x1a\x45\xdf\xa3")  # Matroska / WebM
            or header.startswith(b"RIFF")  # rare AVI; we don't allow .avi but cheap
        )
    else:
        raise ValidationAppError(f"Unknown media kind '{kind}'.", code="invalid_media_kind")

    if not ok:
        path.unlink(missing_ok=True)
        raise ValidationAppError(
            f"File content does not look like a valid {kind} upload.",
            code="invalid_file_content",
        )


def redact_local_paths(text: str) -> str:
    """Replace user home / profile paths in log/API strings with ``<path>``.

    Leaves short system temp prefixes (``/tmp/...``) alone so tests and local
    tooling can still assert on filenames under the storage tree.
    """
    if not text:
        return text
    # Windows user profile paths.
    redacted = re.sub(r"(?i)[a-z]:\\Users\\[^\s\"']+", "<path>", text)
    # macOS / Linux home directories (and legacy /private/var/folders user caches).
    redacted = re.sub(
        r"(?<![A-Za-z0-9_])/(?:Users|home)/[^\s\"']+",
        "<path>",
        redacted,
    )
    return redacted
