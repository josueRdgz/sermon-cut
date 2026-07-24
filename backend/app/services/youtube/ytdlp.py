"""Thin, safe wrapper around the external ``yt-dlp`` executable.

All invocations use an explicit argument list and ``shell=False``. No argument
ever originates from the frontend: the caller passes a pre-validated canonical
URL plus a backend-defined quality; every other flag is fixed here.
"""

from __future__ import annotations

import json
import shutil
import subprocess
import threading
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path

from app.core.config import Settings

# Sentinel prefix for machine-readable progress lines (see _PROGRESS_TEMPLATE).
_PROGRESS_PREFIX = "__SCPROG__"
_PROGRESS_TEMPLATE = (
    "download:" + _PROGRESS_PREFIX + "%(progress.status)s\t"
    "%(progress.downloaded_bytes)s\t%(progress.total_bytes)s\t"
    "%(progress.total_bytes_estimate)s\t%(progress.speed)s\t%(progress.eta)s"
)

# Grace period between SIGTERM and SIGKILL when cancelling a download.
_TERMINATE_TIMEOUT_SECONDS = 8


class YtDlpNotAvailable(RuntimeError):
    """yt-dlp is not installed / not resolvable on PATH."""


@dataclass(frozen=True)
class DownloadProgress:
    """One structured progress sample emitted while downloading."""

    phase: str  # "downloading_video" | "downloading_audio" | "merging"
    status: str | None
    downloaded_bytes: int | None
    total_bytes: int | None
    speed_bps: float | None
    eta_seconds: float | None
    fraction: float | None  # 0..1 within the current file, when known.


@dataclass(frozen=True)
class DownloadResult:
    """Outcome of one yt-dlp download invocation."""

    returncode: int
    cancelled: bool
    stderr_tail: str
    output_path: Path | None
    merged: bool


ProgressCallback = Callable[[DownloadProgress], None]


def locate_ytdlp(settings: Settings) -> str | None:
    """Resolve the yt-dlp executable from settings override or PATH."""
    override = (settings.ytdlp_path or "").strip()
    if override:
        candidate = Path(override).expanduser()
        if candidate.is_file():
            return str(candidate)
        resolved = shutil.which(override)
        if resolved:
            return resolved
        return None
    return shutil.which("yt-dlp")


def require_ytdlp(settings: Settings) -> str:
    exe = locate_ytdlp(settings)
    if exe is None:
        raise YtDlpNotAvailable(
            "yt-dlp no está instalado. Instálalo con 'pip install yt-dlp' "
            "o configura SERMON_CUT_YTDLP_PATH."
        )
    return exe


def ytdlp_version(exe: str) -> str | None:
    try:
        result = subprocess.run(  # noqa: S603 — explicit arg list, no shell
            [exe, "--version"],
            capture_output=True,
            text=True,
            timeout=15,
            check=False,
        )
    except (OSError, subprocess.SubprocessError):
        return None
    out = (result.stdout or "").strip()
    return out or None


def _base_args(exe: str) -> list[str]:
    """Fixed, safe flags shared by metadata and download calls."""
    return [
        exe,
        "--ignore-config",  # never read a user yt-dlp config (arg injection).
        "--no-playlist",  # single video only, even if a list is present.
        "--no-warnings",
        "--no-color",
        "--no-cookies",  # v1: public/unlisted only, no credentials.
    ]


def run_metadata(
    exe: str,
    canonical_url: str,
    *,
    timeout_seconds: float,
) -> tuple[int, dict | None, str]:
    """Run ``--dump-single-json --skip-download`` for a single video.

    Returns ``(returncode, parsed_json_or_None, stderr_tail)``.
    """
    args = [
        *_base_args(exe),
        "--dump-single-json",
        "--skip-download",
        "--",
        canonical_url,
    ]
    try:
        result = subprocess.run(  # noqa: S603 — explicit arg list, no shell
            args,
            capture_output=True,
            text=True,
            timeout=timeout_seconds,
            check=False,
        )
    except subprocess.TimeoutExpired:
        return 1, None, "Timed out while fetching metadata."
    except (OSError, subprocess.SubprocessError) as exc:
        return 1, None, str(exc)

    stderr_tail = (result.stderr or "")[-4000:]
    if result.returncode != 0:
        return result.returncode, None, stderr_tail

    try:
        payload = json.loads(result.stdout)
    except json.JSONDecodeError:
        return 1, None, stderr_tail or "yt-dlp returned invalid JSON."
    if not isinstance(payload, dict):
        return 1, None, "Unexpected metadata payload."
    return 0, payload, stderr_tail


def _parse_progress_line(line: str, phase: str) -> DownloadProgress | None:
    body = line[len(_PROGRESS_PREFIX):]
    parts = body.split("\t")
    if len(parts) < 6:
        return None
    status, dl, total, total_est, speed, eta = parts[:6]

    def _int(value: str) -> int | None:
        try:
            return int(float(value))
        except (ValueError, TypeError):
            return None

    def _float(value: str) -> float | None:
        try:
            return float(value)
        except (ValueError, TypeError):
            return None

    downloaded = _int(dl)
    total_bytes = _int(total) or _int(total_est)
    fraction: float | None = None
    if downloaded is not None and total_bytes:
        fraction = max(0.0, min(downloaded / total_bytes, 1.0))

    return DownloadProgress(
        phase=phase,
        status=status or None,
        downloaded_bytes=downloaded,
        total_bytes=total_bytes,
        speed_bps=_float(speed),
        eta_seconds=_float(eta),
        fraction=fraction,
    )


def run_download(
    exe: str,
    canonical_url: str,
    *,
    format_selector: str,
    output_template: str,
    on_progress: ProgressCallback | None = None,
    cancel_event: threading.Event | None = None,
    log_path: Path | None = None,
) -> DownloadResult:
    """Download a single video, streaming structured progress and honoring cancel.

    Video-only and audio-only streams are fetched separately then merged into an
    MP4 by yt-dlp's FFmpeg post-processor. Phase is inferred from ``Destination``
    and ``[Merger]`` markers, so it is approximate but reliable enough for the UI.
    """
    args = [
        *_base_args(exe),
        "-f",
        format_selector,
        "--merge-output-format",
        "mp4",
        "--newline",
        "--progress-template",
        _PROGRESS_TEMPLATE,
        "--no-mtime",
        "--retries",
        "3",
        "--fragment-retries",
        "3",
        "-o",
        output_template,
        "--",
        canonical_url,
    ]

    log_handle = None
    if log_path is not None:
        log_path.parent.mkdir(parents=True, exist_ok=True)
        log_handle = log_path.open("w", encoding="utf-8", errors="replace")

    cancelled = False
    destination_count = 0
    phase = "downloading_video"
    merged = False
    tail_lines: list[str] = []

    try:
        process = subprocess.Popen(  # noqa: S603 — explicit arg list, no shell
            args,
            stdin=subprocess.DEVNULL,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            bufsize=1,
        )
    except (OSError, subprocess.SubprocessError) as exc:
        if log_handle is not None:
            log_handle.close()
        return DownloadResult(
            returncode=-1,
            cancelled=False,
            stderr_tail=str(exc),
            output_path=None,
            merged=False,
        )

    try:
        assert process.stdout is not None
        for raw in process.stdout:
            if cancel_event is not None and cancel_event.is_set():
                cancelled = True
                _terminate(process)
                break

            line = raw.rstrip("\n")
            if log_handle is not None:
                log_handle.write(raw)
            tail_lines.append(line)
            if len(tail_lines) > 200:
                tail_lines = tail_lines[-200:]

            stripped = line.strip()
            if stripped.startswith("[download] Destination:"):
                destination_count += 1
                phase = (
                    "downloading_video"
                    if destination_count <= 1
                    else "downloading_audio"
                )
                continue
            if stripped.startswith("[Merger]") or "Merging formats into" in stripped:
                merged = True
                phase = "merging"
                if on_progress is not None:
                    on_progress(
                        DownloadProgress(
                            phase="merging",
                            status="merging",
                            downloaded_bytes=None,
                            total_bytes=None,
                            speed_bps=None,
                            eta_seconds=None,
                            fraction=None,
                        )
                    )
                continue
            if _PROGRESS_PREFIX in line:
                idx = line.index(_PROGRESS_PREFIX)
                update = _parse_progress_line(line[idx:], phase)
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
        if log_handle is not None:
            log_handle.close()

    return DownloadResult(
        returncode=process.returncode,
        cancelled=cancelled,
        stderr_tail="\n".join(tail_lines[-60:]),
        output_path=None,
        merged=merged,
    )


def _terminate(process: subprocess.Popen) -> None:
    if process.poll() is not None:
        return
    process.terminate()
    try:
        process.wait(timeout=_TERMINATE_TIMEOUT_SECONDS)
    except subprocess.TimeoutExpired:
        process.kill()
