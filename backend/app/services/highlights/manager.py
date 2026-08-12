"""Asynchronous, persisted Video Highlights semantic analysis manager."""

from __future__ import annotations

import threading
from collections.abc import Callable
from concurrent.futures import Future, ThreadPoolExecutor
from datetime import UTC, datetime
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.exceptions import ConflictError, NotFoundError, ValidationAppError
from app.models.highlight import (
    ACTIVE_HIGHLIGHT_STATUSES,
    HighlightAnalysisJob,
    HighlightAnalysisStatus,
)
from app.models.project import Project, ProjectStatus
from app.models.transcript import TranscriptStatus
from app.schemas.highlight import HighlightAnalysisJobResponse
from app.services.ai.transcript import transcript_to_ai_inputs
from app.services.highlights import service as highlights_service
from app.services.highlights.ai import HighlightProvider
from app.services.transcripts import service as transcripts_service

SessionFactory = Callable[[], Session]
ProviderFactory = Callable[[], HighlightProvider]


def _utc_now() -> datetime:
    return datetime.now(UTC)


class HighlightAnalysisManager:
    def __init__(
        self,
        *,
        session_factory: SessionFactory,
        provider_factory: ProviderFactory | None = None,
        executor: object | None = None,
    ) -> None:
        self._session_factory = session_factory
        self._provider_factory = provider_factory or HighlightProvider
        self._executor = executor or ThreadPoolExecutor(max_workers=1)
        self._events: dict[UUID, threading.Event] = {}
        self._futures: dict[UUID, Future] = {}
        self._contexts: dict[UUID, str] = {}
        self._lock = threading.Lock()

    def start(
        self,
        db: Session,
        project_id: UUID,
        *,
        target_duration_seconds: int,
        editorial_style: str,
        editorial_context: str | None = None,
    ) -> HighlightAnalysisJob:
        project = db.get(Project, project_id)
        if project is None:
            raise NotFoundError("Proyecto no encontrado.", code="project_not_found")
        transcript = transcripts_service.get_transcript_for_project(db, project_id)
        if transcript.status != TranscriptStatus.ready:
            raise ValidationAppError(
                "La transcripción debe estar sincronizada antes del análisis.",
                code="transcript_not_ready",
            )
        plan = highlights_service.get_or_create_plan(db, project_id)
        if plan.sermon_start_seconds is None or plan.sermon_end_seconds is None:
            raise ValidationAppError(
                "Detecte o confirme primero el intervalo de la predicación.",
                code="sermon_range_missing",
            )
        if (plan.sermon_confidence or 0.0) < 0.68:
            raise ValidationAppError(
                "Confirme manualmente el inicio y el final porque la detección "
                "tiene baja confianza.",
                code="sermon_range_confirmation_required",
            )
        active = db.scalars(
            select(HighlightAnalysisJob).where(
                HighlightAnalysisJob.project_id == project_id,
                HighlightAnalysisJob.status.in_(tuple(ACTIVE_HIGHLIGHT_STATUSES)),
            )
        ).first()
        if active is not None:
            raise ConflictError(
                "Ya existe un análisis de Highlights en curso.",
                code="highlight_analysis_in_progress",
            )

        provider = self._provider_factory()
        job = HighlightAnalysisJob(
            project_id=project_id,
            plan_id=plan.id,
            status=HighlightAnalysisStatus.queued,
            stage="queued",
            provider=provider.name,
            target_duration_seconds=target_duration_seconds,
            editorial_style=editorial_style,
            progress=0.0,
        )
        db.add(job)
        project.status = ProjectStatus.analyzing
        project.error_message = None
        db.commit()
        db.refresh(job)

        with self._lock:
            self._events[job.id] = threading.Event()
            if editorial_context and editorial_context.strip():
                self._contexts[job.id] = editorial_context.strip()
        future = self._executor.submit(self._run, job.id)
        with self._lock:
            self._futures[job.id] = future
        db.refresh(job)
        return job

    def get(self, db: Session, job_id: UUID) -> HighlightAnalysisJob:
        job = db.get(HighlightAnalysisJob, job_id)
        if job is None:
            raise NotFoundError(
                "Trabajo de Highlights no encontrado.",
                code="highlight_analysis_job_not_found",
            )
        return job

    def latest(self, db: Session, project_id: UUID) -> HighlightAnalysisJob | None:
        return db.scalars(
            select(HighlightAnalysisJob)
            .where(HighlightAnalysisJob.project_id == project_id)
            .order_by(HighlightAnalysisJob.created_at.desc())
        ).first()

    def cancel(self, db: Session, job_id: UUID) -> HighlightAnalysisJob:
        job = self.get(db, job_id)
        if job.status not in ACTIVE_HIGHLIGHT_STATUSES:
            return job
        with self._lock:
            event = self._events.get(job_id)
            if event is not None:
                event.set()
        job.status = HighlightAnalysisStatus.cancelling
        job.stage = "cancelling"
        db.commit()
        db.refresh(job)
        return job

    def _run(self, job_id: UUID) -> None:
        db: Session | None = self._session_factory()
        try:
            job = db.get(HighlightAnalysisJob, job_id)
            if job is None:
                return
            event = self._event(job_id)
            if event.is_set():
                self._cancelled(db, job)
                return
            job.status = HighlightAnalysisStatus.running
            job.stage = "preparing_transcript"
            job.started_at = _utc_now()
            job.progress = 0.08
            db.commit()

            project = db.get(Project, job.project_id)
            plan = db.get(highlights_service.HighlightPlan, job.plan_id)
            transcript = transcripts_service.get_transcript_for_project(db, job.project_id)
            if project is None or plan is None:
                raise NotFoundError("El proyecto de Highlights ya no existe.")
            with self._lock:
                editorial_context = self._contexts.pop(job_id, None)
            analyze_kwargs = {
                "project_title": project.title,
                "preacher_name": project.preacher_name,
                "bible_reference": project.bible_reference,
                "church_name": project.church_name,
                "editorial_context": editorial_context,
                "segments": transcript_to_ai_inputs(transcript),
                "sermon_start": float(plan.sermon_start_seconds),
                "sermon_end": float(plan.sermon_end_seconds),
                "target_duration_seconds": job.target_duration_seconds,
                "editorial_style": job.editorial_style,
            }
            if event.is_set():
                self._cancelled(db, job)
                return

            job.stage = "semantic_analysis"
            job.progress = 0.22
            db.commit()
            # Release SQLite while Gemini runs so the UI can poll progress.
            db.close()
            db = None

            result = self._provider_factory().analyze(**analyze_kwargs)

            db = self._session_factory()
            job = db.get(HighlightAnalysisJob, job_id)
            project = db.get(Project, job.project_id) if job is not None else None
            plan = (
                db.get(highlights_service.HighlightPlan, job.plan_id)
                if job is not None
                else None
            )
            if job is None or project is None or plan is None:
                raise NotFoundError("El proyecto de Highlights ya no existe.")
            if event.is_set():
                self._cancelled(db, job)
                return

            job.stage = "validating_and_saving"
            job.progress = 0.84
            db.commit()
            highlights_service.apply_ai_result(
                db,
                plan=plan,
                response=result.response,
                target_duration_seconds=job.target_duration_seconds,
                editorial_style=job.editorial_style,
            )
            job.prompt_tokens = result.usage.prompt_tokens
            job.completion_tokens = result.usage.completion_tokens
            job.total_tokens = result.usage.total_tokens
            job.status = HighlightAnalysisStatus.completed
            job.stage = "completed"
            job.progress = 1.0
            job.finished_at = _utc_now()
            project.status = ProjectStatus.editing
            db.commit()
        except Exception as exc:  # noqa: BLE001
            if db is None:
                db = self._session_factory()
            else:
                db.rollback()
            job = db.get(HighlightAnalysisJob, job_id)
            if job is not None:
                job.status = HighlightAnalysisStatus.failed
                job.stage = "failed"
                job.error_message = str(getattr(exc, "detail", exc))[:4000]
                job.finished_at = _utc_now()
                project = db.get(Project, job.project_id)
                if project is not None:
                    project.status = ProjectStatus.failed
                    project.error_message = job.error_message
                db.commit()
        finally:
            with self._lock:
                self._events.pop(job_id, None)
                self._futures.pop(job_id, None)
            if db is not None:
                db.close()

    def _event(self, job_id: UUID) -> threading.Event:
        with self._lock:
            return self._events.setdefault(job_id, threading.Event())

    def _cancelled(self, db: Session, job: HighlightAnalysisJob) -> None:
        job.status = HighlightAnalysisStatus.cancelled
        job.stage = "cancelled"
        job.finished_at = _utc_now()
        project = db.get(Project, job.project_id)
        if project is not None:
            project.status = ProjectStatus.editing
        db.commit()

    def shutdown(self, wait: bool = False) -> None:
        with self._lock:
            for event in self._events.values():
                event.set()
        shutdown = getattr(self._executor, "shutdown", None)
        if callable(shutdown):
            shutdown(wait=wait)


def job_to_response(
    db: Session,
    job: HighlightAnalysisJob,
    *,
    include_plan: bool = True,
) -> HighlightAnalysisJobResponse:
    plan_response = None
    if include_plan and job.status == HighlightAnalysisStatus.completed:
        plan_response = highlights_service.to_response(
            db, highlights_service.get_plan(db, job.project_id)
        )
    return HighlightAnalysisJobResponse(
        id=job.id,
        project_id=job.project_id,
        plan_id=job.plan_id,
        status=job.status.value if hasattr(job.status, "value") else str(job.status),
        stage=job.stage,
        provider=job.provider,
        target_duration_seconds=job.target_duration_seconds,
        editorial_style=job.editorial_style,
        progress=job.progress,
        prompt_tokens=job.prompt_tokens,
        completion_tokens=job.completion_tokens,
        total_tokens=job.total_tokens,
        error_message=job.error_message,
        created_at=job.created_at,
        updated_at=job.updated_at,
        started_at=job.started_at,
        finished_at=job.finished_at,
        plan=plan_response,
    )


_manager: HighlightAnalysisManager | None = None


def get_highlight_analysis_manager() -> HighlightAnalysisManager:
    global _manager
    if _manager is None:
        from app.db.session import SessionLocal

        _manager = HighlightAnalysisManager(session_factory=SessionLocal)
    return _manager
