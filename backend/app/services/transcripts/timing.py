"""Shared helpers for subtitle / caption parsers."""

from __future__ import annotations

import re

from app.core.exceptions import ValidationAppError

# SRT: 00:00:10,200  or  00:00:10.200
# VTT: 00:00:10.200  or  00:10.200 (hours optional)
_TIMESTAMP = re.compile(
    r"^(?:(?P<hours>\d{1,2}):)?(?P<minutes>\d{1,2}):(?P<seconds>\d{1,2})[.,](?P<millis>\d{1,3})$"
)


def parse_timestamp(value: str) -> float:
    """Parse an SRT/VTT timestamp into decimal seconds."""
    raw = value.strip()
    match = _TIMESTAMP.match(raw)
    if not match:
        raise ValidationAppError(
            f"Invalid timestamp: {value!r}",
            code="invalid_timestamp",
        )
    hours = int(match.group("hours") or 0)
    minutes = int(match.group("minutes"))
    seconds = int(match.group("seconds"))
    millis_raw = match.group("millis")
    # Pad/truncate to milliseconds.
    millis = int(millis_raw.ljust(3, "0")[:3])
    return hours * 3600 + minutes * 60 + seconds + millis / 1000.0


def format_timestamp_srt(seconds: float) -> str:
    """Format decimal seconds as ``HH:MM:SS,mmm`` (SRT)."""
    if seconds < 0:
        seconds = 0.0
    total_ms = int(round(seconds * 1000))
    hours, rem = divmod(total_ms, 3_600_000)
    minutes, rem = divmod(rem, 60_000)
    secs, ms = divmod(rem, 1000)
    return f"{hours:02d}:{minutes:02d}:{secs:02d},{ms:03d}"


def format_timestamp_vtt(seconds: float) -> str:
    """Format decimal seconds as ``HH:MM:SS.mmm`` (WebVTT)."""
    return format_timestamp_srt(seconds).replace(",", ".")


def strip_vtt_tags(text: str) -> str:
    """Remove simple WebVTT cue settings / tags while preserving spoken text.

    We strip ``<...>`` tags (e.g. ``<c>``, ``<00:00:01.000>``) but keep the
    surrounding words exactly otherwise.
    """
    return re.sub(r"<[^>]+>", "", text)
