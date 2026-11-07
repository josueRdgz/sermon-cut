"""Extract cached waveform peaks with FFmpeg."""

from __future__ import annotations

import json
import math
import struct
import subprocess
from pathlib import Path

from app.services.render.binary import locate_ffmpeg


def extract_peaks(path: Path, *, buckets: int = 480) -> list[float]:
    if not path.is_file():
        return []
    cache = path.with_suffix(path.suffix + ".peaks.json")
    try:
        if cache.is_file() and cache.stat().st_mtime >= path.stat().st_mtime:
            raw = json.loads(cache.read_text(encoding="utf-8"))
            peaks = raw.get("peaks") if isinstance(raw, dict) else raw
            if isinstance(peaks, list) and peaks:
                return [max(0.0, min(1.0, float(item))) for item in peaks]
    except (OSError, json.JSONDecodeError, TypeError, ValueError):
        pass

    ffmpeg = locate_ffmpeg()
    if not ffmpeg:
        return []
    command = [
        ffmpeg,
        "-v",
        "error",
        "-i",
        str(path),
        "-ac",
        "1",
        "-ar",
        "4000",
        "-f",
        "s16le",
        "-",
    ]
    try:
        result = subprocess.run(
            command,
            capture_output=True,
            check=False,
            timeout=60,
        )
    except (OSError, subprocess.SubprocessError):
        return []
    samples = result.stdout
    if len(samples) < 4:
        return []
    count = len(samples) // 2
    values = struct.unpack("<" + "h" * count, samples[: count * 2])
    size = max(1, math.ceil(count / buckets))
    peaks: list[float] = []
    for start in range(0, count, size):
        window = values[start : start + size]
        peak = max(abs(sample) for sample in window) / 32768.0
        peaks.append(round(min(1.0, peak), 4))
    try:
        cache.write_text(json.dumps({"peaks": peaks}), encoding="utf-8")
    except OSError:
        pass
    return peaks
