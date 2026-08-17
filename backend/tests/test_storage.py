"""Unit tests for filename sanitization and path safety."""

from __future__ import annotations

from pathlib import Path
from uuid import uuid4

import pytest
from app.core.exceptions import ValidationAppError
from app.services.storage import (
    VIDEO_EXTENSIONS,
    assert_file_magic,
    redact_local_paths,
    resolve_inside_project,
    sanitize_filename,
    validate_extension,
    validate_mime,
)


def test_sanitize_strips_path_components() -> None:
    assert sanitize_filename("../../etc/passwd.mp4", fallback_stem="video") == "passwd.mp4"


def test_sanitize_replaces_unsafe_characters() -> None:
    assert sanitize_filename("Mi Sermón (final)!!.mov", fallback_stem="video") == "Mi_Serm_n_final.mov"


def test_sanitize_fallback_when_empty() -> None:
    assert sanitize_filename("..", fallback_stem="video") == "video"
    assert sanitize_filename("", fallback_stem="cover") == "cover"


def test_validate_extension_rejects_unknown() -> None:
    with pytest.raises(ValidationAppError) as exc:
        validate_extension("clip.avi", VIDEO_EXTENSIONS)
    assert exc.value.code == "unsupported_extension"


def test_validate_mime_rejects_unknown() -> None:
    with pytest.raises(ValidationAppError) as exc:
        validate_mime("text/plain", frozenset({"video/mp4"}))
    assert exc.value.code == "unsupported_mime"


def test_resolve_inside_project_blocks_traversal(
    storage_root,  # noqa: ARG001
) -> None:
    project_id = uuid4()
    with pytest.raises(ValidationAppError) as exc:
        resolve_inside_project(project_id, "../../secret.txt")
    assert exc.value.code == "invalid_path"


def test_assert_file_magic_accepts_jpeg(tmp_path: Path) -> None:
    path = tmp_path / "cover.jpg"
    path.write_bytes(b"\xff\xd8\xff\xe0" + b"\x00" * 8)
    assert_file_magic(path, kind="image")


def test_assert_file_magic_rejects_spoofed_image(tmp_path: Path) -> None:
    path = tmp_path / "cover.jpg"
    path.write_bytes(b"not-an-image")
    with pytest.raises(ValidationAppError) as exc:
        assert_file_magic(path, kind="image")
    assert exc.value.code == "invalid_file_content"
    assert not path.exists()


def test_redact_local_paths_hides_home_directories() -> None:
    sample = 'ffmpeg -i "/Users/alice/Movies/sermon.mp4" -y C:\\Users\\bob\\out.mp4'
    redacted = redact_local_paths(sample)
    assert "/Users/alice" not in redacted
    assert "C:\\Users\\bob" not in redacted
    assert "<path>" in redacted
    # Temp / storage paths used in tests must remain readable.
    assert "/tmp/endcard-abc.png" in redact_local_paths(" -i /tmp/endcard-abc.png ")
