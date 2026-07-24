"""Reveal the rendered file in the OS file manager (macOS / Windows / Linux)."""

from __future__ import annotations

import platform
import subprocess
from pathlib import Path

from app.core.exceptions import AppError, ValidationAppError


def reveal_in_file_manager(path: Path) -> dict[str, str]:
    """Open the folder containing ``path``, selecting the file when possible.

    Does not upload or publish — local filesystem only.
    """
    resolved = path.resolve()
    if not resolved.exists():
        raise ValidationAppError("El archivo ya no existe en disco.", code="file_missing")

    system = platform.system()
    try:
        if system == "Darwin":
            subprocess.Popen(  # noqa: S603 — fixed argv, path from our storage
                ["open", "-R", str(resolved)],
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
            )
            method = "open -R"
        elif system == "Windows":
            subprocess.Popen(  # noqa: S603
                ["explorer", f"/select,{resolved}"],
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
            )
            method = "explorer /select"
        else:
            # Linux / other: open the parent directory.
            parent = str(resolved.parent)
            subprocess.Popen(  # noqa: S603
                ["xdg-open", parent],
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
            )
            method = "xdg-open"
    except OSError as exc:
        raise AppError(
            f"No se pudo abrir la carpeta: {exc}",
            code="reveal_failed",
            status_code=500,
        ) from exc

    return {
        "path": str(resolved),
        "directory": str(resolved.parent),
        "platform": system,
        "method": method,
    }
