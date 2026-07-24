"""Tests for SQLite integrity helpers and stale job recovery."""

from __future__ import annotations

from datetime import UTC, datetime

from app.db.session import foreign_keys_enabled
from app.models.project import Project, ProjectStatus
from app.models.reel import AspectRatio, Reel
from app.models.render_job import RenderJob, RenderJobStatus
from app.models.transcription_job import TranscriptionJob, TranscriptionJobStatus
from app.services.job_recovery import reconcile_stale_jobs
from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker


def test_sqlite_foreign_keys_enabled(db_session_factory: sessionmaker) -> None:
    db: Session = db_session_factory()
    try:
        assert foreign_keys_enabled(db) is True
    finally:
        db.close()


def test_delete_project_cascades_render_jobs(db_session_factory: sessionmaker) -> None:
    db: Session = db_session_factory()
    try:
        project = Project(
            title="Cascade",
            church_name="Test Church",
            youtube_channel="test",
            status=ProjectStatus.ready,
        )
        db.add(project)
        db.flush()
        reel = Reel(project_id=project.id, title="R1", aspect_ratio=AspectRatio.nine_sixteen)
        db.add(reel)
        db.flush()
        job = RenderJob(
            project_id=project.id,
            reel_id=reel.id,
            status=RenderJobStatus.completed,
            stage="completed",
            aspect_ratio="9:16",
            layout="center_crop",
        )
        db.add(job)
        db.commit()
        project_id = project.id
        job_id = job.id
        reel_id = reel.id

        db.delete(project)
        db.commit()

        assert db.get(Project, project_id) is None
        assert db.get(RenderJob, job_id) is None
        assert db.get(Reel, reel_id) is None
    finally:
        db.close()


def test_reconcile_stale_jobs_unlocks_project(db_session_factory: sessionmaker) -> None:
    db: Session = db_session_factory()
    try:
        project = Project(
            title="Stuck",
            church_name="Test Church",
            youtube_channel="test",
            status=ProjectStatus.rendering,
        )
        db.add(project)
        db.flush()
        reel = Reel(project_id=project.id, title="R1", aspect_ratio=AspectRatio.nine_sixteen)
        db.add(reel)
        db.flush()
        render = RenderJob(
            project_id=project.id,
            reel_id=reel.id,
            status=RenderJobStatus.running,
            stage="encoding",
            aspect_ratio="9:16",
            layout="center_crop",
            started_at=datetime.now(UTC),
        )
        whisper = TranscriptionJob(
            project_id=project.id,
            status=TranscriptionJobStatus.cancelling,
            stage="cancelling",
            model_name="tiny",
        )
        db.add_all([render, whisper])
        db.commit()

        counts = reconcile_stale_jobs(db)
        assert counts["render"] == 1
        assert counts["transcription"] == 1

        db.refresh(render)
        db.refresh(whisper)
        db.refresh(project)
        assert render.status == RenderJobStatus.failed
        assert whisper.status == TranscriptionJobStatus.cancelled
        assert project.status == ProjectStatus.editing

        active = db.scalars(
            select(RenderJob).where(RenderJob.status == RenderJobStatus.running)
        ).all()
        assert active == []
    finally:
        db.close()
