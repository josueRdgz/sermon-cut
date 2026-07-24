"""API tests for optional AI analysis with the mock provider."""

from __future__ import annotations

from collections.abc import Generator
from pathlib import Path
from uuid import UUID

import pytest
from app.core.config import get_settings
from app.db.base import Base
from app.db.session import get_db
from app.main import create_app
from app.models.transcript import (
    Transcript,
    TranscriptSegment,
    TranscriptSource,
    TranscriptStatus,
)
from app.services.ai.mock_provider import MockAIProvider
from app.services.analysis.manager import AnalysisManager, InlineExecutor, get_analysis_manager
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

SAMPLE_PROJECT = {
    "title": "La gracia suficiente",
    "church_name": "Iglesia Central",
    "youtube_channel": "@central",
}


@pytest.fixture()
def analysis_env(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> Generator[tuple[TestClient, sessionmaker], None, None]:
    projects = tmp_path / "projects"
    projects.mkdir()
    monkeypatch.setattr("app.core.paths.PROJECTS_DIR", projects)
    monkeypatch.setenv("SERMON_CUT_AI_PROVIDER", "mock")
    monkeypatch.delenv("SERMON_CUT_GEMINI_API_KEY", raising=False)
    get_settings.cache_clear()

    url = f"sqlite:///{(tmp_path / 'test.db').as_posix()}"
    monkeypatch.setenv("SERMON_CUT_DATABASE_URL", url)
    monkeypatch.setenv("SERMON_CUT_AUTO_MIGRATE", "false")
    get_settings.cache_clear()

    engine = create_engine(url, connect_args={"check_same_thread": False}, poolclass=StaticPool)
    TestingSessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False)
    Base.metadata.create_all(bind=engine)

    def _override_get_db() -> Generator[Session, None, None]:
        db = TestingSessionLocal()
        try:
            yield db
        finally:
            db.close()

    manager = AnalysisManager(
        session_factory=TestingSessionLocal,
        provider_factory=MockAIProvider,
        executor=InlineExecutor(),
    )

    app = create_app()
    app.dependency_overrides[get_db] = _override_get_db
    app.dependency_overrides[get_analysis_manager] = lambda: manager

    with TestClient(app) as client:
        yield client, TestingSessionLocal

    app.dependency_overrides.clear()
    Base.metadata.drop_all(bind=engine)
    engine.dispose()
    get_settings.cache_clear()


def _seed_project_with_transcript(session_factory: sessionmaker) -> str:
    with session_factory() as db:
        response_project = {
            "title": SAMPLE_PROJECT["title"],
            "church_name": SAMPLE_PROJECT["church_name"],
            "youtube_channel": SAMPLE_PROJECT["youtube_channel"],
            "duration_seconds": 90.0,
        }
        # Create via ORM to avoid upload flow.
        from app.models.project import Project, ProjectStatus

        project = Project(
            title=response_project["title"],
            church_name=response_project["church_name"],
            youtube_channel=response_project["youtube_channel"],
            duration_seconds=90.0,
            status=ProjectStatus.ready,
        )
        db.add(project)
        db.flush()

        transcript = Transcript(
            project_id=project.id,
            source=TranscriptSource.manual,
            status=TranscriptStatus.ready,
            full_text="",
            has_word_timestamps=False,
        )
        windows = [
            (0.0, 12.0, "La gracia de Dios es suficiente para el pecador arrepentido."),
            (12.0, 24.0, "Cristo es el centro de nuestra fe y de nuestra esperanza."),
            (30.0, 42.0, "Arrepiéntanse y crean en el evangelio de la gracia."),
            (50.0, 62.0, "La santidad acompaña a todo aquel que ha sido redimido."),
            (70.0, 82.0, "Guardemos esta esperanza hasta que el Señor vuelva."),
        ]
        for order, (start, end, text) in enumerate(windows):
            transcript.segments.append(
                TranscriptSegment(
                    order=order,
                    start_seconds=start,
                    end_seconds=end,
                    text=text,
                )
            )
        transcript.full_text = "\n".join(text for _, _, text in windows)
        db.add(transcript)
        db.commit()
        return str(project.id)


def test_provider_status_reports_optional_mock(analysis_env) -> None:
    client, _ = analysis_env
    response = client.get("/api/analysis/provider")
    assert response.status_code == 200
    body = response.json()
    assert body["optional"] is True
    assert body["active"] == "mock"
    assert body["gemini_configured"] is False


def test_analysis_requires_transcript(analysis_env) -> None:
    client, session_factory = analysis_env
    with session_factory() as db:
        from app.models.project import Project, ProjectStatus

        project = Project(
            title="Sin transcripción",
            church_name="Iglesia",
            youtube_channel="@x",
            status=ProjectStatus.created,
        )
        db.add(project)
        db.commit()
        project_id = str(project.id)

    response = client.post(f"/api/projects/{project_id}/analysis", json={})
    assert response.status_code == 400
    assert response.json()["code"] == "transcript_missing"


def test_analysis_completes_and_lists_pending_candidates(analysis_env) -> None:
    client, session_factory = analysis_env
    project_id = _seed_project_with_transcript(session_factory)

    started = client.post(
        f"/api/projects/{project_id}/analysis",
        json={
            "max_reels": 3,
            "min_duration_seconds": 10,
            "max_duration_seconds": 40,
            "additional_instructions": "priorizar gracia",
        },
    )
    assert started.status_code == 202, started.text
    body = started.json()
    assert body["status"] == "completed"
    assert body["provider"] == "mock"
    assert body["progress"] == pytest.approx(1.0)
    assert len(body["candidates"]) >= 1
    assert all(item["status"] == "pending" for item in body["candidates"])

    listed = client.get(f"/api/projects/{project_id}/analysis/candidates")
    assert listed.status_code == 200
    assert listed.json()["total"] == len(body["candidates"])


def test_accept_creates_reel_without_rendering(analysis_env) -> None:
    client, session_factory = analysis_env
    project_id = _seed_project_with_transcript(session_factory)

    job = client.post(
        f"/api/projects/{project_id}/analysis",
        json={"max_reels": 2, "min_duration_seconds": 10, "max_duration_seconds": 40},
    ).json()
    candidate_id = job["candidates"][0]["id"]

    accepted = client.post(f"/api/projects/{project_id}/analysis/candidates/{candidate_id}/accept")
    assert accepted.status_code == 200, accepted.text
    payload = accepted.json()
    assert payload["candidate"]["status"] == "accepted"
    reel_id = payload["reel_id"]
    assert UUID(reel_id)

    reel = client.get(f"/api/projects/{project_id}/reels/{reel_id}")
    assert reel.status_code == 200
    assert len(reel.json()["segments"]) >= 1

    # Accepting must not create a render job.
    renders = client.get(f"/api/projects/{project_id}/reels/{reel_id}/renders")
    assert renders.status_code == 200
    assert renders.json()["total"] == 0


def test_reject_candidate(analysis_env) -> None:
    client, session_factory = analysis_env
    project_id = _seed_project_with_transcript(session_factory)
    job = client.post(
        f"/api/projects/{project_id}/analysis",
        json={"max_reels": 2, "min_duration_seconds": 10, "max_duration_seconds": 40},
    ).json()
    candidate_id = job["candidates"][0]["id"]

    rejected = client.post(f"/api/projects/{project_id}/analysis/candidates/{candidate_id}/reject")
    assert rejected.status_code == 200
    assert rejected.json()["status"] == "rejected"

    # Accepting a rejected candidate must fail.
    again = client.post(f"/api/projects/{project_id}/analysis/candidates/{candidate_id}/accept")
    assert again.status_code == 409
