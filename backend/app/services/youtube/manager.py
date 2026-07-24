"""In-process YouTube import manager (yt-dlp).

Mirrors the render/transcription managers: a bounded ``ThreadPoolExecutor`` runs
the yt-dlp subprocess while job state is persisted in SQLite for polling.
Cancellation terminates the process, cleans partial downloads, and never touches
a previously valid project video.
"""

from __future__ import annotations

import logging
import shutil
import threading
import time
from collections.abc import Callable
from concurrent.futures import Future, ThreadPoolExecutor
from datetime import UTC, datetime
from pathlib import Path
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import Settings, get_settings
from app.core.exceptions import AppError, ConflictError, NotFoundError, ValidationAppError
from app.core.paths import project_source_dir
from app.models.project import Project, ProjectStatus
from app.models.youtube_import_job import (
    ACTIVE_YOUTUBE_IMPORT_STATUSES,
    YouTubeImportJob,
    YouTubeImportJobStatus,
)
from app.services import projects as projects_service
from app.services import storage
from app.services.youtube.errors import classify_error
from app.services.youtube.format_selection import build_format_selector, normalize_quality
from app.services.youtube.metadata import (
    YouTubeMetadataError,
    YouTubePreview,
    assert_importable,
    parse_preview,
)
from app.services.youtube.validation import validate_youtube_url
from app.services.youtube.ytdlp import (
    DownloadProgress,
    YtDlpNotAvailable,
    locate_ytdlp,
    require_ytdlp,
    run_download,
    run_metadata,
)

logger = logging.getLogger(__name__)

SessionFactory = Callable[[], Session]

_PROGRESS_COMMIT_INTERVAL = 0.5


class InlineExecutor:
    """Executor that runs work synchronously (used by tests)."""

    def submit(self, fn: Callable[..., object], *args: object, **kwargs: object) -> Future:
        future: Future = Future()
        try:
            future.set_result(fn(*args, **kwargs))
        except BaseException as exc:  # noqa: BLE001 — mirror executor semantics
            future.set_exception(exc)
        return future

    def shutdown(self, wait: bool = True) -> None:  # noqa: ARG002 — interface parity
        return None


def _utc_now() -> datetime:
    return datetime.now(UTC)


def fetch_preview(url: str) -> YouTubePreview:
    """Validate a URL and return a compact, safe preview (no job created).

    This performs steps 2-4 of the flow: syntax/domain validation followed by
    ``yt-dlp --dump-single-json --skip-download``.
    """
    settings = get_settings()
    _assert_enabled(settings)
    validated = validate_youtube_url(url)
    exe = _require_binary(settings)

    rc, payload, tail = run_metadata(
        exe,
        validated.canonical_url,
        timeout_seconds=settings.youtube_metadata_timeout_seconds,
    )
    if rc != 0 or payload is None:
        err = classify_error(tail)
        raise ValidationAppError(err.message, code=err.code)

    preview = parse_preview(payload)
    assert_importable(
        preview,
        payload,
        max_duration_seconds=settings.youtube_max_duration_seconds,
    )
    return preview


def _assert_enabled(settings: Settings) -> None:
    if not settings.youtube_import_enabled:
        raise AppError(
            "La importación desde YouTube está deshabilitada.",
            code="youtube_disabled",
            status_code=403,
        )


def _require_binary(settings: Settings) -> str:
    try:
        return require_ytdlp(settings)
    except YtDlpNotAvailable as exc:
        raise AppError(
            str(exc),
            code="youtube_ytdlp_missing",
            status_code=503,
        ) from exc


def _estimate_download_bytes(payload: dict, height: int | None) -> int | None:
    """Best-effort estimate of the merged download size, in bytes."""
    formats = payload.get("formats")
    best_video = 0
    best_audio = 0
    if isinstance(formats, list):
        for fmt in formats:
            if not isinstance(fmt, dict):
                continue
            size = fmt.get("filesize") or fmt.get("filesize_approx")
            if not isinstance(size, (int, float)) or size <= 0:
                continue
            vcodec = fmt.get("vcodec")
            acodec = fmt.get("acodec")
            fh = fmt.get("height")
            if vcodec and vcodec != "none":
                if height is not None and isinstance(fh, int) and fh > height:
                    continue
                best_video = max(best_video, int(size))
            elif acodec and acodec != "none":
                best_audio = max(best_audio, int(size))
    total = best_video + best_audio
    if total > 0:
        return total

    # Fallback: rough duration * nominal bitrate for the target height.
    duration = payload.get("duration")
    if isinstance(duration, (int, float)) and duration > 0:
        nominal_kbps = 5000 if (height or 1080) >= 1080 else 2800
        return int(duration * nominal_kbps * 1000 / 8)
    return None


class YouTubeImportManager:
    """Owns the executor, cancellation flags, and the import lifecycle."""

    def __init__(
        self,
        *,
        session_factory: SessionFactory,
        executor: object | None = None,
        ytdlp_locator: Callable[[Settings], str | None] = locate_ytdlp,
        downloader: Callable[..., object] = run_download,
        metadata_runner: Callable[..., tuple[int, dict | None, str]] = run_metadata,
        keep_temp: bool = False,
    ) -> None:
        self._session_factory = session_factory
        self._executor = executor or ThreadPoolExecutor(max_workers=1)
        self._ytdlp_locator = ytdlp_locator
        self._downloader = downloader
        self._metadata_runner = metadata_runner
        self._keep_temp = keep_temp
        self._cancel_events: dict[UUID, threading.Event] = {}
        self._futures: dict[UUID, Future] = {}
        self._lock = threading.Lock()

    # ---- public API -------------------------------------------------------

    def start(
        self,
        db: Session,
        project_id: UUID,
        *,
        url: str,
        quality: str | None,
    ) -> YouTubeImportJob:
        """Validate the URL, create an import job, and enqueue the download."""
        settings = get_settings()
        _assert_enabled(settings)

        project = db.get(Project, project_id)
        if project is None:
            raise NotFoundError("Project not found.", code="project_not_found")

        validated = validate_youtube_url(url)
        # Fail fast if the binary is missing (clear 503 instead of a worker error).
        if self._ytdlp_locator(settings) is None:
            raise AppError(
                "yt-dlp no está instalado. Instálalo con 'pip install yt-dlp' "
                "o configura SERMON_CUT_YTDLP_PATH.",
                code="youtube_ytdlp_missing",
                status_code=503,
            )

        active = db.scalars(
            select(YouTubeImportJob).where(
                YouTubeImportJob.project_id == project_id,
                YouTubeImportJob.status.in_(tuple(ACTIVE_YOUTUBE_IMPORT_STATUSES)),
            )
        ).first()
        if active is not None:
            raise ConflictError(
                "Ya hay una importación en curso para este proyecto.",
                code="youtube_import_in_progress",
            )

        job = YouTubeImportJob(
            project_id=project_id,
            status=YouTubeImportJobStatus.queued,
            stage="queued",
            source_url=validated.canonical_url,
            video_id=validated.video_id,
            requested_quality=normalize_quality(
                quality, default=settings.youtube_default_quality
            ),
            progress=0.0,
        )
        db.add(job)
        project.status = ProjectStatus.importing
        project.error_message = None
        db.commit()
        db.refresh(job)

        with self._lock:
            self._cancel_events[job.id] = threading.Event()

        future = self._executor.submit(self._run_job, job.id)
        with self._lock:
            self._futures[job.id] = future

        db.refresh(job)
        return job

    def get(self, db: Session, job_id: UUID) -> YouTubeImportJob:
        job = db.get(YouTubeImportJob, job_id)
        if job is None:
            raise NotFoundError("Import job not found.", code="youtube_job_not_found")
        return job

    def get_latest_for_project(
        self, db: Session, project_id: UUID
    ) -> YouTubeImportJob | None:
        return db.scalars(
            select(YouTubeImportJob)
            .where(YouTubeImportJob.project_id == project_id)
            .order_by(YouTubeImportJob.created_at.desc())
        ).first()

    def cancel(self, db: Session, job_id: UUID) -> YouTubeImportJob:
        job = self.get(db, job_id)
        if job.status not in ACTIVE_YOUTUBE_IMPORT_STATUSES:
            return job

        with self._lock:
            event = self._cancel_events.get(job_id)
        if event is not None:
            event.set()

        if job.status != YouTubeImportJobStatus.cancelling:
            job.status = YouTubeImportJobStatus.cancelling
            job.stage = "cancelling"
            db.commit()
            db.refresh(job)
        return job

    def shutdown(self, wait: bool = False) -> None:
        with self._lock:
            for event in self._cancel_events.values():
                event.set()
        shutdown = getattr(self._executor, "shutdown", None)
        if callable(shutdown):
            shutdown(wait=wait)

    # ---- internals --------------------------------------------------------

    def _event_for(self, job_id: UUID) -> threading.Event:
        with self._lock:
            event = self._cancel_events.get(job_id)
            if event is None:
                event = threading.Event()
                self._cancel_events[job_id] = event
            return event

    def _discard(self, job_id: UUID) -> None:
        with self._lock:
            self._cancel_events.pop(job_id, None)
            self._futures.pop(job_id, None)

    def _run_job(self, job_id: UUID) -> None:
        session = self._session_factory()
        event = self._event_for(job_id)
        source_dir: Path | None = None
        try:
            job = session.get(YouTubeImportJob, job_id)
            if job is None:
                return
            if event.is_set():
                self._mark_cancelled(session, job)
                return

            settings = get_settings()
            exe = self._ytdlp_locator(settings)
            if exe is None:
                raise YtDlpNotAvailable("yt-dlp no está disponible.")

            job.status = YouTubeImportJobStatus.validating
            job.stage = "validating"
            job.started_at = _utc_now()
            job.progress = 0.02
            session.commit()

            # ---- Metadata --------------------------------------------------
            job.status = YouTubeImportJobStatus.fetching_metadata
            job.stage = "fetching_metadata"
            job.progress = 0.04
            session.commit()

            rc, payload, tail = self._metadata_runner(
                exe,
                job.source_url,
                timeout_seconds=settings.youtube_metadata_timeout_seconds,
            )
            if event.is_set():
                self._mark_cancelled(session, job)
                return
            if rc != 0 or payload is None:
                err = classify_error(tail)
                self._mark_failed(session, job_id, err.code, err.message)
                return

            preview = parse_preview(payload)
            assert_importable(
                preview,
                payload,
                max_duration_seconds=settings.youtube_max_duration_seconds,
            )
            height = _target_height(job.requested_quality)
            self._store_preview(session, job, preview)

            # ---- Space / size guards --------------------------------------
            source_dir = project_source_dir(job.project_id)
            source_dir.mkdir(parents=True, exist_ok=True)
            estimate = _estimate_download_bytes(payload, height)
            self._assert_space(source_dir, estimate, settings)

            # ---- Download --------------------------------------------------
            output_template = str(source_dir / f"youtube-{job.video_id}.%(ext)s")
            log_path = source_dir / f"import-{job_id}.log"
            selector = build_format_selector(job.requested_quality)

            job.status = YouTubeImportJobStatus.downloading_video
            job.stage = "downloading_video"
            job.progress = 0.05
            session.commit()

            last_commit = time.monotonic()
            last_phase = job.status

            def on_progress(update: DownloadProgress) -> None:
                nonlocal last_commit, last_phase
                self._apply_progress(job, update)
                if job.status != last_phase:
                    session.commit()
                    last_phase = job.status
                    last_commit = time.monotonic()
                    return
                now = time.monotonic()
                if now - last_commit >= _PROGRESS_COMMIT_INTERVAL:
                    session.commit()
                    last_commit = now

            result = self._downloader(
                exe,
                job.source_url,
                format_selector=selector,
                output_template=output_template,
                on_progress=on_progress,
                cancel_event=event,
                log_path=log_path,
            )

            if getattr(result, "cancelled", False) or event.is_set():
                self._cleanup_partials(source_dir, job.video_id)
                self._mark_cancelled(session, job)
                return

            if getattr(result, "returncode", 1) != 0:
                self._cleanup_partials(source_dir, job.video_id)
                err = classify_error(getattr(result, "stderr_tail", ""))
                self._mark_failed(session, job_id, err.code, err.message)
                return

            downloaded = _find_output(source_dir, job.video_id)
            if downloaded is None or not downloaded.is_file():
                self._cleanup_partials(source_dir, job.video_id)
                self._mark_failed(
                    session,
                    job_id,
                    "youtube_download_failed",
                    "La descarga terminó pero no se encontró el archivo de video.",
                )
                return

            # ---- Register as the project's original video -----------------
            job.status = YouTubeImportJobStatus.probing
            job.stage = "probing"
            job.progress = 0.95
            session.commit()

            stored_name = f"youtube-{job.video_id}.mp4"
            destination = storage.resolve_inside_project(job.project_id, stored_name)
            downloaded.replace(destination)

            project = session.get(Project, job.project_id)
            if project is None:
                self._mark_failed(
                    session, job_id, "project_not_found", "El proyecto ya no existe."
                )
                return

            projects_service.finalize_project_video(
                session, project, stored_name, verify_magic=True
            )

            job.output_filename = stored_name
            job.selected_format = _describe_format(project)
            if project.height:
                job.resolution_label = f"{project.height}p"
            job.status = YouTubeImportJobStatus.completed
            job.stage = "completed"
            job.progress = 1.0
            job.downloaded_bytes = job.total_bytes or job.downloaded_bytes
            job.finished_at = _utc_now()
            session.commit()
        except (YouTubeMetadataError, ValidationAppError) as exc:
            session.rollback()
            code = getattr(exc, "code", "youtube_invalid")
            self._mark_failed(session, job_id, code, str(getattr(exc, "detail", exc)))
            if source_dir is not None:
                self._cleanup_partials(source_dir, _safe_video_id(session, job_id))
        except YtDlpNotAvailable:
            session.rollback()
            self._mark_failed(
                session,
                job_id,
                "youtube_ytdlp_missing",
                "yt-dlp no está disponible en este sistema.",
            )
        except Exception as exc:  # noqa: BLE001 — persist failure for the UI
            session.rollback()
            logger.exception("YouTube import %s failed", job_id)
            self._mark_failed(session, job_id, "youtube_download_failed", str(exc))
            if source_dir is not None:
                self._cleanup_partials(source_dir, _safe_video_id(session, job_id))
        finally:
            if source_dir is not None and not self._keep_temp:
                self._cleanup_logs(source_dir, job_id)
            self._discard(job_id)
            session.close()

    def _apply_progress(self, job: YouTubeImportJob, update: DownloadProgress) -> None:
        phase = update.phase
        fraction = update.fraction or 0.0
        if phase == "downloading_video":
            job.status = YouTubeImportJobStatus.downloading_video
            job.stage = "downloading_video"
            job.progress = round(0.05 + 0.50 * fraction, 4)
        elif phase == "downloading_audio":
            job.status = YouTubeImportJobStatus.downloading_audio
            job.stage = "downloading_audio"
            job.progress = round(0.55 + 0.30 * fraction, 4)
        elif phase == "merging":
            job.status = YouTubeImportJobStatus.merging
            job.stage = "merging"
            job.progress = max(job.progress, 0.90)

        if update.downloaded_bytes is not None:
            job.downloaded_bytes = update.downloaded_bytes
        if update.total_bytes is not None:
            job.total_bytes = update.total_bytes
        job.speed_bps = update.speed_bps
        job.eta_seconds = update.eta_seconds

    def _store_preview(
        self, session: Session, job: YouTubeImportJob, preview: YouTubePreview
    ) -> None:
        job.title = preview.title
        job.channel = preview.channel
        job.duration_seconds = preview.duration_seconds
        job.thumbnail_url = preview.thumbnail_url
        job.resolution_label = preview.resolution_label
        job.upload_date = preview.upload_date
        session.commit()

    def _assert_space(
        self, source_dir: Path, estimate: int | None, settings: Settings
    ) -> None:
        if estimate is not None and estimate > settings.youtube_max_estimated_bytes:
            raise ValidationAppError(
                "El video estimado supera el tamaño máximo permitido para importar.",
                code="youtube_too_large",
            )
        try:
            free = shutil.disk_usage(source_dir).free
        except OSError:
            return
        needed = (estimate or 0) + settings.youtube_min_free_bytes
        if free < needed:
            raise ValidationAppError(
                "No hay espacio en disco suficiente para descargar el video.",
                code="youtube_no_space",
            )

    def _cleanup_partials(self, source_dir: Path, video_id: str | None) -> None:
        """Remove incomplete downloads without touching a valid project video."""
        if self._keep_temp or not source_dir.exists():
            return
        patterns = ["*.part", "*.ytdl", "*.temp", "*.f*.mp4", "*.f*.m4a", "*.f*.webm"]
        if video_id:
            patterns.append(f"youtube-{video_id}.*")
        for pattern in patterns:
            for path in source_dir.glob(pattern):
                try:
                    path.unlink()
                except OSError:
                    logger.warning("Could not remove partial download %s", path)

    def _cleanup_logs(self, source_dir: Path, job_id: UUID) -> None:
        log_path = source_dir / f"import-{job_id}.log"
        if log_path.exists():
            try:
                log_path.unlink()
            except OSError:
                logger.warning("Could not remove import log %s", log_path)

    def _mark_cancelled(self, session: Session, job: YouTubeImportJob) -> None:
        job.status = YouTubeImportJobStatus.cancelled
        job.stage = "cancelled"
        job.finished_at = _utc_now()
        project = session.get(Project, job.project_id)
        if project is not None and project.status == ProjectStatus.importing:
            # Never mark ready on cancel; fall back to the pre-import state.
            project.status = (
                ProjectStatus.ready if project.video_filename else ProjectStatus.created
            )
        session.commit()

    def _mark_failed(
        self, session: Session, job_id: UUID, code: str, message: str
    ) -> None:
        job = session.get(YouTubeImportJob, job_id)
        if job is None:
            return
        job.status = YouTubeImportJobStatus.failed
        job.stage = "failed"
        job.error_code = code
        job.error_message = message[:4000]
        job.finished_at = _utc_now()
        project = session.get(Project, job.project_id)
        if project is not None and project.status == ProjectStatus.importing:
            project.status = (
                ProjectStatus.ready if project.video_filename else ProjectStatus.created
            )
            project.error_message = message[:2000]
        session.commit()


def _target_height(quality: str) -> int | None:
    from app.services.youtube.format_selection import (
        QUALITY_720P,
        QUALITY_BEST,
    )

    if quality == QUALITY_720P:
        return 720
    if quality == QUALITY_BEST:
        return None
    return 1080


def _describe_format(project: Project) -> str:
    parts: list[str] = []
    if project.width and project.height:
        parts.append(f"{project.width}x{project.height}")
    codecs = "/".join(c for c in (project.video_codec, project.audio_codec) if c)
    if codecs:
        parts.append(codecs)
    return " ".join(parts) or "mp4"


def _find_output(source_dir: Path, video_id: str) -> Path | None:
    """Locate the merged output file for a video id, preferring MP4."""
    preferred = source_dir / f"youtube-{video_id}.mp4"
    if preferred.is_file():
        return preferred
    for candidate in sorted(source_dir.glob(f"youtube-{video_id}.*")):
        if candidate.suffix.lower() in {".part", ".ytdl", ".temp"}:
            continue
        if ".f" in candidate.name:  # intermediate per-format stream
            continue
        if candidate.is_file():
            return candidate
    return None


def _safe_video_id(session: Session, job_id: UUID) -> str | None:
    job = session.get(YouTubeImportJob, job_id)
    return job.video_id if job is not None else None


_manager: YouTubeImportManager | None = None


def get_youtube_import_manager() -> YouTubeImportManager:
    """Return the process-wide YouTube import manager (FastAPI dependency)."""
    global _manager
    if _manager is None:
        from app.db.session import SessionLocal

        _manager = YouTubeImportManager(session_factory=SessionLocal)
    return _manager
