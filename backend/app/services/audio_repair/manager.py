"""Background lifecycle for project audio analysis and repair."""

from __future__ import annotations

import json
import shutil
import threading
import time
from collections.abc import Callable
from concurrent.futures import Future, ThreadPoolExecutor
from dataclasses import asdict
from datetime import UTC, datetime
from pathlib import Path
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.exceptions import ConflictError, NotFoundError, ValidationAppError
from app.core.paths import audio_repair_temp_dir
from app.models.audio_repair import (
    ACTIVE_AUDIO_REPAIR_STATUSES,
    AudioRepairJob,
    AudioRepairJobStatus,
)
from app.models.project import Project
from app.services import storage
from app.services.audio_repair.engine import analyze_and_repair_wav
from app.services.audio_repair.pipeline import (
    extract_pcm,
    mux_repaired_audio,
    repaired_video_name,
)

SessionFactory = Callable[[], Session]


def _utc_now() -> datetime:
    return datetime.now(UTC)


class AudioRepairManager:
    """Run one local audio-repair worker and persist progress for polling."""

    def __init__(
        self,
        *,
        session_factory: SessionFactory,
        executor: object | None = None,
        extractor: Callable[..., Path] = extract_pcm,
        muxer: Callable[..., Path] = mux_repaired_audio,
        repairer: Callable[..., object] = analyze_and_repair_wav,
    ) -> None:
        self._session_factory = session_factory
        self._executor = executor or ThreadPoolExecutor(max_workers=1)
        self._extractor = extractor
        self._muxer = muxer
        self._repairer = repairer
        self._cancel_events: dict[UUID, threading.Event] = {}
        self._futures: dict[UUID, Future] = {}
        self._lock = threading.Lock()

    def start(
        self,
        db: Session,
        project_id: UUID,
        *,
        silence_threshold: int,
        min_dropout_ms: float,
        max_auto_repair_ms: float,
        max_review_ms: float,
    ) -> AudioRepairJob:
        project = db.get(Project, project_id)
        if project is None:
            raise NotFoundError("Project not found.", code="project_not_found")
        if not project.video_filename:
            raise ValidationAppError(
                "The project has no video with audio to repair.",
                code="video_missing",
            )
        active = db.scalars(
            select(AudioRepairJob).where(
                AudioRepairJob.project_id == project_id,
                AudioRepairJob.status.in_(tuple(ACTIVE_AUDIO_REPAIR_STATUSES)),
            )
        ).first()
        if active is not None:
            raise ConflictError(
                "Audio repair is already running for this project.",
                code="audio_repair_in_progress",
            )

        job = AudioRepairJob(
            project_id=project_id,
            status=AudioRepairJobStatus.queued,
            stage="queued",
            progress=0,
            silence_threshold=silence_threshold,
            min_dropout_ms=min_dropout_ms,
            max_auto_repair_ms=max_auto_repair_ms,
            max_review_ms=max_review_ms,
        )
        db.add(job)
        db.commit()
        db.refresh(job)
        with self._lock:
            self._cancel_events[job.id] = threading.Event()
        future = self._executor.submit(self._run_job, job.id)
        with self._lock:
            self._futures[job.id] = future
        db.refresh(job)
        return job

    def get(self, db: Session, job_id: UUID) -> AudioRepairJob:
        job = db.get(AudioRepairJob, job_id)
        if job is None:
            raise NotFoundError("Audio repair job not found.", code="audio_repair_not_found")
        return job

    def get_latest_for_project(self, db: Session, project_id: UUID) -> AudioRepairJob | None:
        return db.scalars(
            select(AudioRepairJob)
            .where(AudioRepairJob.project_id == project_id)
            .order_by(AudioRepairJob.created_at.desc())
        ).first()

    def cancel(self, db: Session, job_id: UUID) -> AudioRepairJob:
        job = self.get(db, job_id)
        if job.status not in ACTIVE_AUDIO_REPAIR_STATUSES:
            return job
        with self._lock:
            event = self._cancel_events.get(job_id)
        if event is not None:
            event.set()
        job.status = AudioRepairJobStatus.cancelling
        job.stage = "cancelling"
        db.commit()
        db.refresh(job)
        return job

    def repaired_audio_path(self, job: AudioRepairJob) -> Path:
        if job.status != AudioRepairJobStatus.completed or not job.repaired_audio_filename:
            raise NotFoundError("Repaired audio is not ready.", code="repaired_audio_missing")
        path = storage.resolve_inside_project(job.project_id, job.repaired_audio_filename)
        if not path.is_file():
            raise NotFoundError("Repaired audio file is missing.", code="repaired_audio_missing")
        return path

    def repaired_video_path(self, job: AudioRepairJob) -> Path:
        if job.status != AudioRepairJobStatus.completed or not job.repaired_video_filename:
            raise NotFoundError("Repaired video is not ready.", code="repaired_video_missing")
        path = storage.resolve_inside_project(job.project_id, job.repaired_video_filename)
        if not path.is_file():
            raise NotFoundError("Repaired video file is missing.", code="repaired_video_missing")
        return path

    def _event_for(self, job_id: UUID) -> threading.Event:
        with self._lock:
            return self._cancel_events.setdefault(job_id, threading.Event())

    def _run_job(self, job_id: UUID) -> None:
        session = self._session_factory()
        event = self._event_for(job_id)
        temp_dir = audio_repair_temp_dir(job_id)
        last_progress_commit = 0.0
        try:
            job = session.get(AudioRepairJob, job_id)
            if job is None:
                return
            if event.is_set():
                self._mark_cancelled(session, job)
                return
            project = session.get(Project, job.project_id)
            if project is None or not project.video_filename:
                raise ValidationAppError("Project video is missing.", code="video_missing")
            source = storage.resolve_inside_project(project.id, project.video_filename)
            temp_dir.mkdir(parents=True, exist_ok=True)
            extracted = temp_dir / "source.wav"
            repaired_temp = temp_dir / "repaired.wav"

            job.status = AudioRepairJobStatus.running
            job.stage = "extracting_audio"
            job.started_at = _utc_now()
            job.progress = 0.03
            session.commit()
            self._extractor(
                source,
                extracted,
                cancel_event=event,
                log_path=temp_dir / "extract.log",
            )
            if event.is_set():
                self._mark_cancelled(session, job)
                return

            job.stage = "analyzing"
            job.progress = 0.15
            session.commit()

            def update_progress(value: float) -> None:
                nonlocal last_progress_commit
                job.progress = round(0.15 + 0.6 * max(0.0, min(1.0, value)), 4)
                job.stage = "repairing" if value >= 0.7 else "analyzing"
                now = time.monotonic()
                if now - last_progress_commit >= 0.5:
                    session.commit()
                    last_progress_commit = now

            result = self._repairer(
                extracted,
                repaired_temp,
                silence_threshold=job.silence_threshold,
                min_dropout_ms=job.min_dropout_ms,
                max_auto_repair_ms=job.max_auto_repair_ms,
                max_review_ms=job.max_review_ms,
                cancel_event=event,
                on_progress=update_progress,
            )
            if event.is_set():
                self._mark_cancelled(session, job)
                return

            project_dir = storage.ensure_project_dir(project.id)
            audio_name = "repaired-audio.wav"
            audio_output = project_dir / audio_name
            audio_pending = project_dir / ".repaired-audio.pending.wav"
            shutil.copyfile(repaired_temp, audio_pending)
            audio_pending.replace(audio_output)

            job.stage = "creating_video"
            job.progress = 0.82
            session.commit()
            video_name = repaired_video_name(source)
            video_output = project_dir / video_name
            self._muxer(
                source,
                audio_output,
                video_output,
                cancel_event=event,
                log_path=temp_dir / "mux.log",
            )
            if event.is_set():
                self._mark_cancelled(session, job)
                return

            issues = [asdict(issue) for issue in result.issues]
            job.issue_count = len(issues)
            job.repaired_count = result.repaired_count
            job.review_count = sum(not issue["repairable"] for issue in issues)
            job.issues_json = json.dumps(issues, separators=(",", ":"))
            job.repaired_audio_filename = audio_name
            job.repaired_video_filename = video_name
            job.status = AudioRepairJobStatus.completed
            job.stage = "completed"
            job.progress = 1.0
            job.finished_at = _utc_now()
            session.commit()
        except InterruptedError:
            session.rollback()
            job = session.get(AudioRepairJob, job_id)
            if job is not None:
                self._mark_cancelled(session, job)
        except Exception as exc:  # noqa: BLE001 — surface worker errors to the UI
            session.rollback()
            job = session.get(AudioRepairJob, job_id)
            if job is not None:
                job.status = AudioRepairJobStatus.failed
                job.stage = "failed"
                job.error_message = str(exc)[:2000]
                job.finished_at = _utc_now()
                session.commit()
        finally:
            shutil.rmtree(temp_dir, ignore_errors=True)
            with self._lock:
                self._cancel_events.pop(job_id, None)
                self._futures.pop(job_id, None)
            session.close()

    @staticmethod
    def _mark_cancelled(session: Session, job: AudioRepairJob) -> None:
        job.status = AudioRepairJobStatus.cancelled
        job.stage = "cancelled"
        job.finished_at = _utc_now()
        session.commit()

    def shutdown(self, wait: bool = False) -> None:
        with self._lock:
            for event in self._cancel_events.values():
                event.set()
        shutdown = getattr(self._executor, "shutdown", None)
        if callable(shutdown):
            shutdown(wait=wait)


_manager: AudioRepairManager | None = None


def get_audio_repair_manager() -> AudioRepairManager:
    global _manager
    if _manager is None:
        from app.db.session import SessionLocal

        _manager = AudioRepairManager(session_factory=SessionLocal)
    return _manager
