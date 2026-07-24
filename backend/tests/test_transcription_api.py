"""API tests for the transcription endpoints with a simulated engine."""

from __future__ import annotations

from collections.abc import Generator, Iterator
from pathlib import Path

import pytest
from app.core.config import get_settings
from app.db.base import Base
from app.db.session import get_db
from app.main import create_app
from app.models.project import Project, ProjectStatus
from app.services.whisper.device import DeviceSelection
from app.services.whisper.engine import EngineInfo, EngineSegment, EngineWord
from app.services.whisper.manager import InlineExecutor, JobManager, get_job_manager
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool


class _FakeEngine:
    def transcribe(
        self, audio_path: Path, **_: object
    ) -> tuple[EngineInfo, Iterator[EngineSegment]]:
        info = EngineInfo(language="es", duration=12.0)

        def _gen() -> Iterator[EngineSegment]:
            yield EngineSegment(0.0, 6.0, "Hola", [EngineWord(0.0, 1.0, "Hola", 0.9)])
            yield EngineSegment(6.0, 12.0, "mundo", [])

        return info, _gen()


def _fake_extractor(video_path: Path, audio_path: Path) -> Path:
    audio_path.parent.mkdir(parents=True, exist_ok=True)
    audio_path.write_bytes(b"RIFFfake")
    return audio_path


def _cpu_selector(_pref: str, _compute: str) -> DeviceSelection:
    return DeviceSelection(device="cpu", compute_type="int8", is_apple_silicon=True,
                           notice="CPU en Apple Silicon")


@pytest.fixture()
def transcription_client(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> Generator[tuple[TestClient, sessionmaker], None, None]:
    projects = tmp_path / "projects"
    temp = tmp_path / "temp"
    projects.mkdir()
    temp.mkdir()
    monkeypatch.setattr("app.core.paths.PROJECTS_DIR", projects)
    monkeypatch.setattr("app.core.paths.TEMP_DIR", temp)

    url = f"sqlite:///{(tmp_path / 'test.db').as_posix()}"
    monkeypatch.setenv("SERMON_CUT_DATABASE_URL", url)
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

    manager = JobManager(
        session_factory=TestingSessionLocal,
        engine=_FakeEngine(),
        executor=InlineExecutor(),
        audio_extractor=_fake_extractor,
        device_selector=_cpu_selector,
    )

    app = create_app()
    app.dependency_overrides[get_db] = _override_get_db
    app.dependency_overrides[get_job_manager] = lambda: manager

    with TestClient(app) as client:
        yield client, TestingSessionLocal

    app.dependency_overrides.clear()
    Base.metadata.drop_all(bind=engine)
    engine.dispose()
    get_settings.cache_clear()


def _create_project_with_video(session_factory: sessionmaker) -> str:
    with session_factory() as db:
        project = Project(
            title="Sermón",
            church_name="Iglesia",
            youtube_channel="canal",
            video_filename="video.mp4",
            duration_seconds=12.0,
            status=ProjectStatus.ready,
        )
        db.add(project)
        db.commit()
        return str(project.id)


def test_start_get_and_cancel_flow(transcription_client) -> None:
    client, session_factory = transcription_client
    project_id = _create_project_with_video(session_factory)

    resp = client.post(
        f"/api/projects/{project_id}/transcription",
        json={"model_name": "small", "language": "es"},
    )
    assert resp.status_code == 202, resp.text
    body = resp.json()
    # With the inline executor the job runs to completion synchronously.
    assert body["status"] == "completed"
    assert body["device"] == "cpu"
    assert body["notice"] is not None
    assert body["progress"] == pytest.approx(1.0)

    latest = client.get(f"/api/projects/{project_id}/transcription")
    assert latest.status_code == 200
    assert latest.json()["detected_language"] == "es"

    job_id = body["id"]
    single = client.get(f"/api/transcription-jobs/{job_id}")
    assert single.status_code == 200

    # Cancelling a finished job is a no-op that returns the job unchanged.
    cancel = client.post(f"/api/transcription-jobs/{job_id}/cancel")
    assert cancel.status_code == 200
    assert cancel.json()["status"] == "completed"

    transcript = client.get(f"/api/projects/{project_id}/transcript")
    assert transcript.status_code == 200
    assert len(transcript.json()["segments"]) == 2


def test_start_without_video_returns_400(transcription_client) -> None:
    client, session_factory = transcription_client
    with session_factory() as db:
        project = Project(
            title="Sin video",
            church_name="Iglesia",
            youtube_channel="canal",
            status=ProjectStatus.created,
        )
        db.add(project)
        db.commit()
        project_id = str(project.id)

    resp = client.post(
        f"/api/projects/{project_id}/transcription",
        json={"model_name": "small", "language": "es"},
    )
    assert resp.status_code == 400
    assert resp.json()["code"] == "video_missing"


def test_get_latest_when_none_returns_404(transcription_client) -> None:
    client, session_factory = transcription_client
    project_id = _create_project_with_video(session_factory)
    resp = client.get(f"/api/projects/{project_id}/transcription")
    assert resp.status_code == 404
