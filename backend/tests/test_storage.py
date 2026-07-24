"""Unit tests for filename sanitization and path safety."""

from __future__ import annotations

from uuid import uuid4

import pytest
from app.core.exceptions import ValidationAppError
from app.services.storage import (
    VIDEO_EXTENSIONS,
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
    # Even if a malicious name slips through, only the basename is used.
    path = resolve_inside_project(project_id, "../../secret.txt")
    assert path.name == "secret.txt"
    assert str(project_id) in str(path)
