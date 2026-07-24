"""Detection of the FFmpeg / FFprobe binaries installed on the system.

We rely on the system-installed ``ffmpeg`` and ``ffprobe`` rather than bundling
them. This module only checks availability and reports their versions.
"""

from __future__ import annotations

import shutil
import subprocess
from dataclasses import dataclass


@dataclass(frozen=True)
class ToolStatus:
    """Availability and parsed version of a CLI tool."""

    available: bool
    version: str | None = None


def _parse_version(output: str) -> str | None:
    """Extract a short version string from the first line of ``-version``.

    Example first line: ``ffmpeg version 8.1 Copyright (c) ...`` -> ``8.1``.
    """
    first_line = output.strip().splitlines()[0] if output.strip() else ""
    parts = first_line.split()
    # Expected shape: [name, "version", <version>, ...]
    if len(parts) >= 3 and parts[1] == "version":
        return parts[2]
    return first_line or None


def _probe_tool(name: str) -> ToolStatus:
    """Return the status of a single tool by running ``<name> -version``."""
    executable = shutil.which(name)
    if executable is None:
        return ToolStatus(available=False)

    try:
        result = subprocess.run(
            [executable, "-version"],
            capture_output=True,
            text=True,
            timeout=10,
            check=False,
        )
    except (OSError, subprocess.SubprocessError):
        return ToolStatus(available=False)

    if result.returncode != 0:
        return ToolStatus(available=False)

    return ToolStatus(available=True, version=_parse_version(result.stdout))


def get_ffmpeg_status() -> ToolStatus:
    """Return availability and version of ffmpeg."""
    return _probe_tool("ffmpeg")


def get_ffprobe_status() -> ToolStatus:
    """Return availability and version of ffprobe."""
    return _probe_tool("ffprobe")
