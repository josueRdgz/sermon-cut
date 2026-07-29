"""Locate an FFmpeg build with the filters required by the renderer."""

from __future__ import annotations

import shutil
import subprocess
from functools import lru_cache
from pathlib import Path

from app.core.config import get_settings


@lru_cache(maxsize=16)
def ffmpeg_has_filter(binary: str, filter_name: str) -> bool:
    """Return whether an FFmpeg executable advertises a named AVFilter."""
    try:
        completed = subprocess.run(
            [binary, "-hide_banner", "-filters"],
            capture_output=True,
            text=True,
            check=False,
            timeout=10,
        )
    except (OSError, subprocess.TimeoutExpired):
        return False
    output = f"{completed.stdout}\n{completed.stderr}"
    return any(
        len(parts := line.split()) >= 2 and parts[1] == filter_name
        for line in output.splitlines()
    )


def locate_ffmpeg() -> str | None:
    """Prefer ffmpeg-full because Homebrew's reduced build omits libass."""
    configured = get_settings().ffmpeg_path
    candidates = [
        configured,
        "/opt/homebrew/opt/ffmpeg-full/bin/ffmpeg",
        "/usr/local/opt/ffmpeg-full/bin/ffmpeg",
        shutil.which("ffmpeg"),
    ]
    for candidate in candidates:
        if candidate and Path(candidate).is_file():
            return str(Path(candidate))
    return None
