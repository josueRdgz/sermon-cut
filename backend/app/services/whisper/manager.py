"""In-process transcription job manager.

No Celery, no Redis: jobs run on a bounded ``ThreadPoolExecutor`` and their
state is persisted in SQLite so the frontend can poll progress. The whisper
decode loop releases the GIL inside CTranslate2, so threads are appropriate and
keep the loaded model resident (unlike a ProcessPoolExecutor).

Cancellation is cooperative: a ``threading.Event`` per job is checked between
segments and around the expensive stages.
"""

from __future__ import annotations

import threading
import time
from collections.abc import Callable
from concurrent.futures import Future, ThreadPoolExecutor
from datetime import UTC, datetime
from pathlib import Path
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.exceptions import AppError, ConflictError, NotFoundError, ValidationAppError
from app.core.paths import job_temp_dir
from app.models.project import Project, ProjectStatus
from app.models.transcript import TranscriptSource
from app.models.transcription_job import (
    ACTIVE_JOB_STATUSES,
    TranscriptionJob,
    TranscriptionJobStatus,
)
from app.services import storage
from app.services.transcripts import service as transcripts_service
from app.services.transcripts.types import ParsedSegment, ParsedTranscript, ParsedWord
from app.services.whisper.audio import AudioExtractionCancelled, extract_audio
from app.services.whisper.device import DeviceSelection, select_device
from app.services.whisper.engine import TranscriptionEngine, get_default_engine

SessionFactory = Callable[[], Session]
AudioExtractor = Callable[..., Path]
DeviceSelector = Callable[[str, str], DeviceSelection]

# How often (seconds) progress is flushed to SQLite while transcribing.
_PROGRESS_COMMIT_INTERVAL = 0.5


class InlineExecutor:
    """Executor that runs work synchronously in the calling thread.

    Useful for tests: submitting a job runs it to completion immediately.
    """

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


class JobManager:
    """Owns the executor, cancellation flags, and the transcription lifecycle."""

    def __init__(
        self,
        *,
        session_factory: SessionFactory,
        engine: TranscriptionEngine,
        executor: object | None = None,
        audio_extractor: AudioExtractor = extract_audio,
        device_selector: DeviceSelector = select_device,
        keep_temp_audio: bool = False,
    ) -> None:
        self._session_factory = session_factory
        self._engine = engine
        self._executor = executor or ThreadPoolExecutor(max_workers=1)
        self._audio_extractor = audio_extractor
        self._device_selector = device_selector
        self._keep_temp_audio = keep_temp_audio
        self._cancel_events: dict[UUID, threading.Event] = {}
        self._futures: dict[UUID, Future] = {}
        self._lock = threading.Lock()

    # ---- public API -------------------------------------------------------

    def start(
        self,
        db: Session,
        project_id: UUID,
        *,
        model_name: str,
        language_option: str,
    ) -> TranscriptionJob:
        """Create and enqueue a transcription job for a project."""
        project = db.get(Project, project_id)
        if project is None:
            raise NotFoundError("Project not found.", code="project_not_found")
        if not project.video_filename:
            raise ValidationAppError(
                "The project has no video to transcribe.",
                code="video_missing",
            )

        active = db.scalars(
            select(TranscriptionJob).where(
                TranscriptionJob.project_id == project_id,
                TranscriptionJob.status.in_(tuple(ACTIVE_JOB_STATUSES)),
            )
        ).first()
        if active is not None:
            raise ConflictError(
                "A transcription is already in progress for this project.",
                code="transcription_in_progress",
            )

        settings = get_settings()
        job = TranscriptionJob(
            project_id=project_id,
            status=TranscriptionJobStatus.queued,
            stage="queued",
            model_name=model_name,
            language_option=language_option,
            total_seconds=project.duration_seconds,
            progress=0.0,
            processed_seconds=0.0,
        )
        db.add(job)
        project.status = ProjectStatus.transcribing
        db.commit()
        db.refresh(job)

        with self._lock:
            self._cancel_events[job.id] = threading.Event()

        job_id = job.id
        pref = settings.whisper_device
        compute = settings.whisper_compute_type
        future = self._executor.submit(self._run_job, job_id, pref, compute)
        with self._lock:
            self._futures[job_id] = future
        # Reflect any state a synchronous executor may already have written.
        db.refresh(job)
        return job

    def get(self, db: Session, job_id: UUID) -> TranscriptionJob:
        job = db.get(TranscriptionJob, job_id)
        if job is None:
            raise NotFoundError("Transcription job not found.", code="job_not_found")
        return job

    def get_latest_for_project(self, db: Session, project_id: UUID) -> TranscriptionJob | None:
        return db.scalars(
            select(TranscriptionJob)
            .where(TranscriptionJob.project_id == project_id)
            .order_by(TranscriptionJob.created_at.desc())
        ).first()

    def cancel(self, db: Session, job_id: UUID) -> TranscriptionJob:
        """Request cooperative cancellation of a job."""
        job = self.get(db, job_id)
        if job.status not in ACTIVE_JOB_STATUSES:
            return job

        with self._lock:
            event = self._cancel_events.get(job_id)
        if event is not None:
            event.set()

        if job.status in {TranscriptionJobStatus.queued, TranscriptionJobStatus.running}:
            job.status = TranscriptionJobStatus.cancelling
            job.stage = "cancelling"
            db.commit()
            db.refresh(job)
        return job

    # ---- internals --------------------------------------------------------

    def _event_for(self, job_id: UUID) -> threading.Event:
        with self._lock:
            event = self._cancel_events.get(job_id)
            if event is None:
                event = threading.Event()
                self._cancel_events[job_id] = event
            return event

    def _discard_event(self, job_id: UUID) -> None:
        with self._lock:
            self._cancel_events.pop(job_id, None)
            self._futures.pop(job_id, None)

    def _cleanup_temp(self, job_id: UUID) -> None:
        if self._keep_temp_audio:
            return
        directory = job_temp_dir(job_id)
        if directory.exists():
            import shutil

            shutil.rmtree(directory, ignore_errors=True)

    def _run_job(self, job_id: UUID, device_pref: str, compute_pref: str) -> None:
        session = self._session_factory()
        event = self._event_for(job_id)
        try:
            job = session.get(TranscriptionJob, job_id)
            if job is None:
                return

            if event.is_set():
                self._mark_cancelled(session, job)
                return

            job.status = TranscriptionJobStatus.running
            job.started_at = _utc_now()
            job.stage = "extracting_audio"
            job.progress = 0.02
            selection = self._device_selector(device_pref, compute_pref)
            job.device = selection.device
            job.compute_type = selection.compute_type
            job.notice = selection.notice
            project_id = job.project_id
            model_name = job.model_name
            language_option = job.language_option
            session.commit()

            project = session.get(Project, project_id)
            if project is None or not project.video_filename:
                raise ValidationAppError(
                    "The project video is no longer available.",
                    code="video_missing",
                )
            video_path = storage.resolve_inside_project(project_id, project.video_filename)

            temp_dir = job_temp_dir(job_id)
            temp_dir.mkdir(parents=True, exist_ok=True)
            audio_path = temp_dir / "audio.wav"

            if event.is_set():
                self._mark_cancelled(session, job)
                return
            try:
                self._audio_extractor(video_path, audio_path, cancel_event=event)
            except TypeError:
                # Test doubles may still use the two-argument signature.
                self._audio_extractor(video_path, audio_path)
            except AudioExtractionCancelled:
                self._mark_cancelled(session, job)
                return
            except AppError:
                if event.is_set():
                    self._mark_cancelled(session, job)
                    return
                raise

            job.stage = "loading_model"
            job.progress = 0.08
            session.commit()
            if event.is_set():
                self._mark_cancelled(session, job)
                return

            language = None if language_option in {"", "auto"} else language_option
            info, seg_iter = self._engine.transcribe(
                audio_path,
                model_name=model_name,
                language=language,
                device=selection.device,
                compute_type=selection.compute_type,
                word_timestamps=True,
            )

            total = job.total_seconds or info.duration
            job.total_seconds = total
            job.detected_language = info.language
            job.stage = "transcribing"
            session.commit()

            parsed_segments: list[ParsedSegment] = []
            has_words = False
            processed = 0.0
            last_commit = time.monotonic()
            cancelled = False

            for seg in seg_iter:
                if event.is_set():
                    cancelled = True
                    break
                words = [
                    ParsedWord(
                        text=word.text,
                        start=word.start,
                        end=word.end,
                        confidence=word.probability,
                    )
                    for word in seg.words
                ]
                if words:
                    has_words = True
                parsed_segments.append(
                    ParsedSegment(text=seg.text, start=seg.start, end=seg.end, words=words)
                )
                processed = seg.end
                job.processed_seconds = processed
                if total:
                    ratio = max(0.0, min(processed / total, 1.0))
                    job.progress = round(0.1 + 0.85 * ratio, 4)
                now = time.monotonic()
                if now - last_commit >= _PROGRESS_COMMIT_INTERVAL:
                    session.commit()
                    last_commit = now

            if cancelled:
                self._mark_cancelled(session, job)
                return

            job.stage = "saving"
            job.progress = 0.99
            session.commit()

            parsed = ParsedTranscript(
                segments=parsed_segments,
                language=info.language,
                has_timing=True,
                has_word_timestamps=has_words,
            )
            transcripts_service.replace_transcript_from_parsed(
                session,
                project_id,
                source=TranscriptSource.whisper,
                parsed=parsed,
                commit=False,
            )

            job.status = TranscriptionJobStatus.completed
            job.stage = "completed"
            job.progress = 1.0
            job.processed_seconds = total or processed
            job.finished_at = _utc_now()
            session.commit()
        except Exception as exc:  # noqa: BLE001 — persist failure for the UI
            session.rollback()
            self._mark_failed(session, job_id, str(exc))
        finally:
            self._cleanup_temp(job_id)
            self._discard_event(job_id)
            session.close()

    def _mark_cancelled(self, session: Session, job: TranscriptionJob) -> None:
        job.status = TranscriptionJobStatus.cancelled
        job.stage = "cancelled"
        job.finished_at = _utc_now()
        project = session.get(Project, job.project_id)
        if project is not None and project.status == ProjectStatus.transcribing:
            project.status = (
                ProjectStatus.ready if project.video_filename else ProjectStatus.created
            )
        session.commit()

    def _mark_failed(self, session: Session, job_id: UUID, message: str) -> None:
        job = session.get(TranscriptionJob, job_id)
        if job is None:
            return
        job.status = TranscriptionJobStatus.failed
        job.stage = "failed"
        job.error_message = message[:2000]
        job.finished_at = _utc_now()
        project = session.get(Project, job.project_id)
        if project is not None and project.status == ProjectStatus.transcribing:
            project.status = ProjectStatus.failed
            project.error_message = message[:2000]
        session.commit()

    def shutdown(self, wait: bool = False) -> None:
        """Signal active jobs to cancel and stop accepting new work."""
        with self._lock:
            for event in self._cancel_events.values():
                event.set()
        shutdown = getattr(self._executor, "shutdown", None)
        if callable(shutdown):
            shutdown(wait=wait)


_manager: JobManager | None = None


def get_job_manager() -> JobManager:
    """Return the process-wide job manager (FastAPI dependency)."""
    global _manager
    if _manager is None:
        settings = get_settings()
        # Bind lazily to the app's default session factory.
        from app.db.session import SessionLocal

        _manager = JobManager(
            session_factory=SessionLocal,
            engine=get_default_engine(),
            keep_temp_audio=settings.keep_temp_audio,
        )
    return _manager
