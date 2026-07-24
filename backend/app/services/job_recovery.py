"""Reconcile in-process job rows left behind after a crash or reload."""

from __future__ import annotations

import logging
from datetime import UTC, datetime

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.analysis import ACTIVE_ANALYSIS_STATUSES, AnalysisJob, AnalysisJobStatus
from app.models.project import Project, ProjectStatus
from app.models.render_job import ACTIVE_RENDER_STATUSES, RenderJob, RenderJobStatus
from app.models.transcription_job import (
    ACTIVE_JOB_STATUSES,
    TranscriptionJob,
    TranscriptionJobStatus,
)
from app.models.youtube_import_job import (
    ACTIVE_YOUTUBE_IMPORT_STATUSES,
    YouTubeImportJob,
    YouTubeImportJobStatus,
)

logger = logging.getLogger(__name__)

_INTERRUPT_MESSAGE = "Interrupted by application restart."


def _utc_now() -> datetime:
    return datetime.now(UTC)


def reconcile_stale_jobs(session: Session) -> dict[str, int]:
    """Mark orphaned active jobs as failed/cancelled and unlock projects.

    Job managers keep ``threading.Event`` state in memory. After a process
    restart those Events are gone, so rows stuck in ``queued`` /
    ``running`` / ``cancelling`` would permanently block new work.
    """
    now = _utc_now()
    counts = {"render": 0, "transcription": 0, "analysis": 0, "youtube_import": 0}

    renders = list(
        session.scalars(
            select(RenderJob).where(RenderJob.status.in_(tuple(ACTIVE_RENDER_STATUSES)))
        ).all()
    )
    for job in renders:
        if job.status == RenderJobStatus.cancelling:
            job.status = RenderJobStatus.cancelled
            job.stage = "cancelled"
        else:
            job.status = RenderJobStatus.failed
            job.stage = "failed"
            job.error_message = _INTERRUPT_MESSAGE
        job.finished_at = now
        counts["render"] += 1

    transcriptions = list(
        session.scalars(
            select(TranscriptionJob).where(
                TranscriptionJob.status.in_(tuple(ACTIVE_JOB_STATUSES))
            )
        ).all()
    )
    for job in transcriptions:
        if job.status == TranscriptionJobStatus.cancelling:
            job.status = TranscriptionJobStatus.cancelled
            job.stage = "cancelled"
        else:
            job.status = TranscriptionJobStatus.failed
            job.stage = "failed"
            job.error_message = _INTERRUPT_MESSAGE
        job.finished_at = now
        counts["transcription"] += 1

    analyses = list(
        session.scalars(
            select(AnalysisJob).where(AnalysisJob.status.in_(tuple(ACTIVE_ANALYSIS_STATUSES)))
        ).all()
    )
    for job in analyses:
        if job.status == AnalysisJobStatus.cancelling:
            job.status = AnalysisJobStatus.cancelled
            job.stage = "cancelled"
        else:
            job.status = AnalysisJobStatus.failed
            job.stage = "failed"
            job.error_message = _INTERRUPT_MESSAGE
        job.finished_at = now
        counts["analysis"] += 1

    youtube_imports = list(
        session.scalars(
            select(YouTubeImportJob).where(
                YouTubeImportJob.status.in_(tuple(ACTIVE_YOUTUBE_IMPORT_STATUSES))
            )
        ).all()
    )
    for job in youtube_imports:
        if job.status == YouTubeImportJobStatus.cancelling:
            job.status = YouTubeImportJobStatus.cancelled
            job.stage = "cancelled"
        else:
            job.status = YouTubeImportJobStatus.failed
            job.stage = "failed"
            job.error_code = "youtube_interrupted"
            job.error_message = _INTERRUPT_MESSAGE
        job.finished_at = now
        counts["youtube_import"] += 1

    # Unlock projects stuck in worker statuses with no remaining active work.
    stuck = list(
        session.scalars(
            select(Project).where(
                Project.status.in_(
                    (
                        ProjectStatus.rendering,
                        ProjectStatus.transcribing,
                        ProjectStatus.analyzing,
                        ProjectStatus.importing,
                    )
                )
            )
        ).all()
    )
    for project in stuck:
        if project.status == ProjectStatus.importing:
            # Mid-import crash: keep a valid prior video (ready) or fall back to
            # the pre-import "created" state. There is no "draft" status.
            project.status = (
                ProjectStatus.ready if project.video_filename else ProjectStatus.created
            )
            project.error_message = _INTERRUPT_MESSAGE
            continue
        project.status = ProjectStatus.editing
        if project.error_message and "Interrupted" in project.error_message:
            pass
        elif any(counts.values()):
            project.error_message = _INTERRUPT_MESSAGE

    session.commit()
    total = sum(counts.values())
    if total:
        logger.warning(
            "Reconciled %s stale job(s): render=%s transcription=%s analysis=%s "
            "youtube_import=%s",
            total,
            counts["render"],
            counts["transcription"],
            counts["analysis"],
            counts["youtube_import"],
        )
    return counts
