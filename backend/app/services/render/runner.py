"""Run FFmpeg as a subprocess with progress reporting and cancellation.

``shell=True`` is never used: the argument list built by ``args.py`` is handed to
``subprocess.Popen`` directly.
"""

from __future__ import annotations

import subprocess
import threading
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path

from app.services.render.progress import ProgressAccumulator, ProgressUpdate

ProgressCallback = Callable[[ProgressUpdate], None]

# Grace period between SIGTERM and SIGKILL when cancelling.
_TERMINATE_TIMEOUT_SECONDS = 5


@dataclass(frozen=True)
class RunResult:
    """Outcome of one FFmpeg invocation."""

    returncode: int
    cancelled: bool
    stderr_tail: str


class FFmpegError(RuntimeError):
    """FFmpeg exited with a non-zero status."""

    def __init__(self, returncode: int, stderr_tail: str) -> None:
        super().__init__(f"FFmpeg exited with code {returncode}: {stderr_tail}")
        self.returncode = returncode
        self.stderr_tail = stderr_tail


def run_ffmpeg(
    args: list[str],
    *,
    on_progress: ProgressCallback | None = None,
    cancel_event: threading.Event | None = None,
    log_path: Path | None = None,
    poll_interval: float = 0.25,
) -> RunResult:
    """Execute FFmpeg, streaming ``-progress`` output and honoring cancellation.

    stderr is written to ``log_path`` (when given) so a large diagnostic dump can
    never fill the pipe buffer and deadlock the reader.
    """
    stderr_target = None
    if log_path is not None:
        log_path.parent.mkdir(parents=True, exist_ok=True)
        stderr_target = log_path.open("wb")

    accumulator = ProgressAccumulator()
    cancelled = False

    try:
        process = subprocess.Popen(  # noqa: S603 — explicit arg list, no shell
            args,
            stdin=subprocess.DEVNULL,
            stdout=subprocess.PIPE,
            stderr=stderr_target or subprocess.PIPE,
            text=True,
            bufsize=1,
        )
    except (OSError, subprocess.SubprocessError) as exc:
        if stderr_target is not None:
            stderr_target.close()
        raise FFmpegError(-1, str(exc)) from exc

    try:
        assert process.stdout is not None
        for line in process.stdout:
            if cancel_event is not None and cancel_event.is_set():
                cancelled = True
                _terminate(process)
                break
            update = accumulator.feed(line)
            if update is not None and on_progress is not None:
                on_progress(update)

        if not cancelled and cancel_event is not None and cancel_event.is_set():
            cancelled = True
            _terminate(process)

        try:
            process.wait(timeout=None if not cancelled else _TERMINATE_TIMEOUT_SECONDS)
        except subprocess.TimeoutExpired:
            process.kill()
            process.wait()
    finally:
        if process.stdout is not None:
            process.stdout.close()
        if stderr_target is not None:
            stderr_target.close()

    stderr_tail = _read_tail(log_path) if log_path is not None else ""
    result = RunResult(
        returncode=process.returncode,
        cancelled=cancelled,
        stderr_tail=stderr_tail,
    )
    if not cancelled and process.returncode != 0:
        raise FFmpegError(process.returncode, stderr_tail)
    return result


def _terminate(process: subprocess.Popen) -> None:
    if process.poll() is not None:
        return
    process.terminate()
    try:
        process.wait(timeout=_TERMINATE_TIMEOUT_SECONDS)
    except subprocess.TimeoutExpired:
        process.kill()


def _read_tail(path: Path, *, max_chars: int = 4000) -> str:
    if not path.is_file():
        return ""
    try:
        text = path.read_text(encoding="utf-8", errors="replace")
    except OSError:
        return ""
    return text[-max_chars:]
