"""Parse FFmpeg's ``-progress pipe:1`` key=value stream."""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class ProgressUpdate:
    """One flushed progress block from FFmpeg."""

    out_time_seconds: float | None
    frame: int | None
    speed: float | None
    finished: bool


def parse_progress_line(line: str) -> tuple[str, str] | None:
    """Split a ``key=value`` progress line, or return ``None`` if malformed."""
    stripped = line.strip()
    if not stripped or "=" not in stripped:
        return None
    key, _, value = stripped.partition("=")
    return key.strip(), value.strip()


class ProgressAccumulator:
    """Collects key=value lines and emits an update at each block boundary.

    FFmpeg writes a group of keys ending with ``progress=continue`` (or
    ``progress=end``), so we buffer until that terminator appears.
    """

    def __init__(self) -> None:
        self._fields: dict[str, str] = {}

    def feed(self, line: str) -> ProgressUpdate | None:
        parsed = parse_progress_line(line)
        if parsed is None:
            return None
        key, value = parsed
        self._fields[key] = value
        if key != "progress":
            return None

        update = ProgressUpdate(
            out_time_seconds=self._out_time_seconds(),
            frame=_as_int(self._fields.get("frame")),
            speed=_as_speed(self._fields.get("speed")),
            finished=value == "end",
        )
        self._fields.clear()
        return update

    def _out_time_seconds(self) -> float | None:
        micros = _as_int(self._fields.get("out_time_us"))
        if micros is None:
            micros = _as_int(self._fields.get("out_time_ms"))
            # Despite the name, older FFmpeg builds also report microseconds here.
            if micros is not None:
                return max(0.0, micros / 1_000_000)
            return _parse_timestamp(self._fields.get("out_time"))
        return max(0.0, micros / 1_000_000)


def _as_int(value: str | None) -> int | None:
    if value is None or value in {"N/A", ""}:
        return None
    try:
        return int(value)
    except ValueError:
        return None


def _as_speed(value: str | None) -> float | None:
    if not value or value == "N/A":
        return None
    try:
        return float(value.rstrip("x"))
    except ValueError:
        return None


def _parse_timestamp(value: str | None) -> float | None:
    """Parse ``HH:MM:SS.micros`` into seconds."""
    if not value or value == "N/A":
        return None
    parts = value.split(":")
    try:
        numbers = [float(part) for part in parts]
    except ValueError:
        return None
    seconds = 0.0
    for number in numbers:
        seconds = seconds * 60 + number
    return max(0.0, seconds)
