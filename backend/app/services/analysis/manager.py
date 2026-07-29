"""In-process AI analysis job manager.

Mirrors the transcription/render managers: a bounded ThreadPoolExecutor runs the
provider calls while job state lives in SQLite for polling. No Celery/Redis.
Cancellation is cooperative via a per-job Event checked between chunks.
"""

from __future__ import annotations

import logging
import threading
from collections.abc import Callable
from concurrent.futures import Future, ThreadPoolExecutor
from datetime import UTC, datetime
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.exceptions import ConflictError, NotFoundError, ValidationAppError
from app.models.analysis import (
    ACTIVE_ANALYSIS_STATUSES,
    AnalysisJob,
    AnalysisJobStatus,
)
from app.models.project import Project, ProjectStatus
from app.models.transcript import TranscriptStatus
from app.services.ai import resolve_provider
from app.services.ai.base import AIProvider
from app.services.ai.schemas import (
    AnalysisPreferences,
    AnalysisRequest,
    ProviderResult,
    SermonMetadata,
    TranscriptSegmentInput,
    TranscriptWordInput,
)
from app.services.analysis.chunking import chunk_segments, request_for_chunk
from app.services.analysis.service import persist_candidates
from app.services.analysis.validate import validate_analysis_response
from app.services.transcripts import service as transcripts_service

logger = logging.getLogger(__name__)

SessionFactory = Callable[[], Session]
ProviderFactory = Callable[[], AIProvider]


class InlineExecutor:
    """Runs work synchronously (used by tests)."""

    def submit(self, fn: Callable[..., object], *args: object, **kwargs: object) -> Future:
        future: Future = Future()
        try:
            future.set_result(fn(*args, **kwargs))
        except BaseException as exc:  # noqa: BLE001 — mirror executor semantics
            future.set_exception(exc)
        return future

    def shutdown(self, wait: bool = True) -> None:  # noqa: ARG002
        return None


def _utc_now() -> datetime:
    return datetime.now(UTC)


class AnalysisManager:
    """Owns the executor, cancel flags and the analysis lifecycle."""

    def __init__(
        self,
        *,
        session_factory: SessionFactory,
        provider_factory: ProviderFactory | None = None,
        executor: object | None = None,
    ) -> None:
        self._session_factory = session_factory
        self._provider_factory = provider_factory or resolve_provider
        self._executor = executor or ThreadPoolExecutor(max_workers=1)
        self._cancel_events: dict[UUID, threading.Event] = {}
        self._futures: dict[UUID, Future] = {}
        self._lock = threading.Lock()

    def start(
        self,
        db: Session,
        project_id: UUID,
        *,
        max_reels: int,
        min_duration_seconds: float,
        max_duration_seconds: float,
        additional_instructions: str | None,
        doctrinal_orientation: str | None,
    ) -> AnalysisJob:
        project = db.get(Project, project_id)
        if project is None:
            raise NotFoundError("Project not found.", code="project_not_found")

        try:
            transcript = transcripts_service.get_transcript_for_project(db, project_id)
        except NotFoundError as exc:
            raise ValidationAppError(
                "The project has no transcript to analyse.",
                code="transcript_missing",
            ) from exc

        if transcript.status != TranscriptStatus.ready:
            raise ValidationAppError(
                "The transcript must be ready (synced) before analysis.",
                code="transcript_not_ready",
            )

        timed = [
            seg
            for seg in transcript.segments
            if seg.start_seconds is not None and seg.end_seconds is not None
        ]
        if not timed:
            raise ValidationAppError(
                "The transcript has no timed segments.",
                code="transcript_unsynced",
            )

        if max_duration_seconds < min_duration_seconds:
            raise ValidationAppError(
                "max_duration_seconds must be >= min_duration_seconds.",
                code="invalid_duration_range",
            )

        active = db.scalars(
            select(AnalysisJob).where(
                AnalysisJob.project_id == project_id,
                AnalysisJob.status.in_(tuple(ACTIVE_ANALYSIS_STATUSES)),
            )
        ).first()
        if active is not None:
            raise ConflictError(
                "An analysis is already in progress for this project.",
                code="analysis_in_progress",
            )

        provider = self._provider_factory()
        settings = get_settings()
        orientation = (
            doctrinal_orientation
            or "cristiano reformado: centralidad de Cristo, gracia, fe, santidad"
        )

        job = AnalysisJob(
            project_id=project_id,
            status=AnalysisJobStatus.queued,
            stage="queued",
            provider=provider.name,
            max_reels=max_reels,
            min_duration_seconds=min_duration_seconds,
            max_duration_seconds=max_duration_seconds,
            additional_instructions=additional_instructions,
            doctrinal_orientation=orientation,
            progress=0.0,
            notice=(
                None
                if provider.name == "gemini"
                else "Proveedor mock (sin Gemini). La app funciona igual; "
                "configura SERMON_CUT_GEMINI_API_KEY para usar Gemini."
            ),
        )
        db.add(job)
        project.status = ProjectStatus.analyzing
        db.commit()
        db.refresh(job)

        with self._lock:
            self._cancel_events[job.id] = threading.Event()

        future = self._executor.submit(self._run_job, job.id)
        with self._lock:
            self._futures[job.id] = future

        # Reflect state a synchronous executor may already have written.
        db.refresh(job)
        _ = settings  # reserved for future chunk limit overrides at start time
        return job

    def get(self, db: Session, job_id: UUID) -> AnalysisJob:
        from app.services.analysis.service import get_job

        return get_job(db, job_id)

    def get_latest_for_project(self, db: Session, project_id: UUID) -> AnalysisJob | None:
        from app.services.analysis.service import get_latest_job

        return get_latest_job(db, project_id)

    def cancel(self, db: Session, job_id: UUID) -> AnalysisJob:
        job = self.get(db, job_id)
        if job.status not in ACTIVE_ANALYSIS_STATUSES:
            return job

        with self._lock:
            event = self._cancel_events.get(job_id)
        if event is not None:
            event.set()

        if job.status in {AnalysisJobStatus.queued, AnalysisJobStatus.running}:
            job.status = AnalysisJobStatus.cancelling
            job.stage = "cancelling"
            db.commit()
            db.refresh(job)
        return job

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
        try:
            job = session.get(AnalysisJob, job_id)
            if job is None:
                return
            if event.is_set():
                self._mark_cancelled(session, job)
                return

            job.status = AnalysisJobStatus.running
            job.started_at = _utc_now()
            job.stage = "preparing"
            job.progress = 0.02
            session.commit()

            project = session.get(Project, job.project_id)
            if project is None:
                raise ValidationAppError("Project missing.", code="project_not_found")

            transcript = transcripts_service.get_transcript_for_project(session, job.project_id)
            segments = _transcript_to_inputs(transcript)
            video_duration = float(project.duration_seconds or segments[-1].end)
            settings = get_settings()

            preferences = AnalysisPreferences(
                max_reels=job.max_reels,
                min_duration_seconds=job.min_duration_seconds,
                max_duration_seconds=job.max_duration_seconds,
                max_segments_per_reel=settings.ai_max_segments_per_reel,
                min_segment_seconds=settings.ai_min_segment_seconds,
                additional_instructions=job.additional_instructions,
                doctrinal_orientation=job.doctrinal_orientation
                or "cristiano reformado: centralidad de Cristo, gracia, fe, santidad",
            )
            base_request = AnalysisRequest(
                metadata=SermonMetadata(
                    title=project.title,
                    preacher_name=project.preacher_name,
                    bible_reference=project.bible_reference,
                    church_name=project.church_name,
                    youtube_channel=project.youtube_channel,
                    duration_seconds=video_duration,
                ),
                segments=segments,
                preferences=preferences,
            )

            chunks = chunk_segments(segments, char_limit=settings.ai_chunk_char_limit)
            job.chunk_count = len(chunks)
            job.stage = "analysing"
            job.progress = 0.05
            session.commit()

            if event.is_set():
                self._mark_cancelled(session, job)
                return

            provider = self._provider_factory()
            job.provider = provider.name
            session.commit()

            chunk_results: list[ProviderResult] = []
            prompt_tokens = 0
            completion_tokens = 0
            total_tokens = 0

            for chunk in chunks:
                if event.is_set():
                    self._mark_cancelled(session, job)
                    return
                result = provider.analyze(request_for_chunk(base_request, chunk))
                chunk_results.append(result)
                if result.usage:
                    prompt_tokens += result.usage.prompt_tokens or 0
                    completion_tokens += result.usage.completion_tokens or 0
                    total_tokens += result.usage.total_tokens or 0
                job.chunks_completed = len(chunk_results)
                job.progress = round(0.05 + 0.7 * (len(chunk_results) / max(1, len(chunks))), 4)
                session.commit()

            if event.is_set():
                self._mark_cancelled(session, job)
                return

            job.stage = "merging"
            job.progress = 0.8
            session.commit()
            merged = provider.merge_candidates(base_request, chunk_results)
            if merged.usage:
                prompt_tokens += merged.usage.prompt_tokens or 0
                completion_tokens += merged.usage.completion_tokens or 0
                total_tokens += merged.usage.total_tokens or 0

            job.stage = "validating"
            job.progress = 0.9
            session.commit()

            report = validate_analysis_response(
                merged.response,
                segments=segments,
                video_duration=video_duration,
                min_segment_seconds=max(
                    settings.min_reel_segment_seconds,
                    preferences.min_segment_seconds,
                ),
                max_segments_per_clip=preferences.max_segments_per_reel,
                merge_gap_seconds=settings.ai_merge_gap_seconds,
                min_clip_seconds=preferences.min_duration_seconds,
                max_clip_seconds=preferences.max_duration_seconds,
            )
            # Cap to the requested maximum after validation.
            accepted = report.accepted[: job.max_reels]
            persist_candidates(session, job=job, clips=accepted)

            job.prompt_tokens = prompt_tokens or None
            job.completion_tokens = completion_tokens or None
            job.total_tokens = total_tokens or None
            job.rejected_count = len(report.rejected)
            if report.rejected:
                job.notice = (
                    (job.notice + "\n" if job.notice else "")
                    + f"{len(report.rejected)} candidato(s) rechazados por falta "
                    "de evidencia, duración insuficiente, exceso de cortes o "
                    "intervalos inválidos."
                )
            job.status = AnalysisJobStatus.completed
            job.stage = "completed"
            job.progress = 1.0
            job.finished_at = _utc_now()
            if project.status == ProjectStatus.analyzing:
                project.status = ProjectStatus.editing
            session.commit()
        except Exception as exc:  # noqa: BLE001 — persist failure for the UI
            session.rollback()
            self._mark_failed(session, job_id, str(exc))
        finally:
            self._discard(job_id)
            session.close()

    def _mark_cancelled(self, session: Session, job: AnalysisJob) -> None:
        job.status = AnalysisJobStatus.cancelled
        job.stage = "cancelled"
        job.finished_at = _utc_now()
        project = session.get(Project, job.project_id)
        if project is not None and project.status == ProjectStatus.analyzing:
            project.status = ProjectStatus.editing
        session.commit()

    def _mark_failed(self, session: Session, job_id: UUID, message: str) -> None:
        job = session.get(AnalysisJob, job_id)
        if job is None:
            return
        job.status = AnalysisJobStatus.failed
        job.stage = "failed"
        job.error_message = message[:4000]
        job.finished_at = _utc_now()
        project = session.get(Project, job.project_id)
        if project is not None and project.status == ProjectStatus.analyzing:
            project.status = ProjectStatus.failed
            project.error_message = message[:2000]
        session.commit()

    def shutdown(self, wait: bool = False) -> None:
        """Cancel in-flight analysis jobs and stop the executor."""
        with self._lock:
            for event in self._cancel_events.values():
                event.set()
        shutdown = getattr(self._executor, "shutdown", None)
        if callable(shutdown):
            shutdown(wait=wait)


def _transcript_to_inputs(transcript) -> list[TranscriptSegmentInput]:
    items: list[TranscriptSegmentInput] = []
    for segment in sorted(transcript.segments, key=lambda s: s.order):
        if segment.start_seconds is None or segment.end_seconds is None:
            continue
        words = [
            TranscriptWordInput(
                start=float(word.start_seconds),
                end=float(word.end_seconds),
                text=word.text,
            )
            for word in sorted(segment.words, key=lambda w: w.order)
            if word.start_seconds is not None and word.end_seconds is not None
        ]
        items.append(
            TranscriptSegmentInput(
                order=segment.order,
                start=float(segment.start_seconds),
                end=float(segment.end_seconds),
                text=segment.text,
                words=words,
            )
        )
    return items


_manager: AnalysisManager | None = None


def get_analysis_manager() -> AnalysisManager:
    global _manager
    if _manager is None:
        from app.db.session import SessionLocal

        _manager = AnalysisManager(session_factory=SessionLocal)
    return _manager
