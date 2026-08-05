"""API coverage for local audio-repair jobs."""

from __future__ import annotations

import math
import wave
from array import array
from collections.abc import Generator
from pathlib import Path

import pytest
from app.core import paths
from app.core.config import get_settings
from app.db.base import Base
from app.db.session import get_db
from app.main import create_app
from app.models.project import Project, ProjectStatus
from app.services.audio_repair.manager import (
    AudioRepairManager,
    get_audio_repair_manager,
)
from app.services.whisper.manager import InlineExecutor
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool


def _fake_extractor(
    _source: Path,
    destination: Path,
    **_: object,
) -> Path:
    rate = 16_000
    samples = array("h")
    for frame in range(rate):
        value = round(7000 * math.sin(2 * math.pi * 220 * frame / rate))
        if 8000 <= frame < 8160:
            value = 0
        samples.extend((value, value))
    destination.parent.mkdir(parents=True, exist_ok=True)
    with wave.open(str(destination), "wb") as writer:
        writer.setnchannels(2)
        writer.setsampwidth(2)
        writer.setframerate(rate)
        writer.writeframes(samples.tobytes())
    return destination


def _fake_extractor_with_review_gap(
    _source: Path,
    destination: Path,
    **_: object,
) -> Path:
    """10 ms auto-safe gap plus a 100 ms review-length gap."""
    rate = 16_000
    samples = array("h")
    for frame in range(rate * 2):
        value = round(7000 * math.sin(2 * math.pi * 220 * frame / rate))
        if 8000 <= frame < 8160:  # 10 ms
            value = 0
        if 20_000 <= frame < 21_600:  # 100 ms
            value = 0
        samples.extend((value, value))
    destination.parent.mkdir(parents=True, exist_ok=True)
    with wave.open(str(destination), "wb") as writer:
        writer.setnchannels(2)
        writer.setsampwidth(2)
        writer.setframerate(rate)
        writer.writeframes(samples.tobytes())
    return destination


def _fake_muxer(
    _source: Path,
    _audio: Path,
    output: Path,
    **_: object,
) -> Path:
    output.write_bytes(b"repaired-video")
    return output


@pytest.fixture()
def audio_repair_client(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> Generator[tuple[TestClient, sessionmaker, Path], None, None]:
    projects_dir = tmp_path / "projects"
    temp_dir = tmp_path / "temp"
    projects_dir.mkdir()
    temp_dir.mkdir()
    monkeypatch.setattr(paths, "PROJECTS_DIR", projects_dir)
    monkeypatch.setattr(paths, "TEMP_DIR", temp_dir)

    url = f"sqlite:///{(tmp_path / 'test.db').as_posix()}"
    monkeypatch.setenv("SERMON_CUT_DATABASE_URL", url)
    monkeypatch.setenv("SERMON_CUT_AUTO_MIGRATE", "false")
    get_settings.cache_clear()
    engine = create_engine(url, connect_args={"check_same_thread": False}, poolclass=StaticPool)
    testing_session = sessionmaker(bind=engine, autoflush=False, autocommit=False)
    Base.metadata.create_all(engine)

    def override_db() -> Generator[Session, None, None]:
        session = testing_session()
        try:
            yield session
        finally:
            session.close()

    manager = AudioRepairManager(
        session_factory=testing_session,
        executor=InlineExecutor(),
        extractor=_fake_extractor,
        muxer=_fake_muxer,
    )
    app = create_app()
    app.dependency_overrides[get_db] = override_db
    app.dependency_overrides[get_audio_repair_manager] = lambda: manager
    with TestClient(app) as client:
        yield client, testing_session, projects_dir

    app.dependency_overrides.clear()
    Base.metadata.drop_all(engine)
    engine.dispose()
    get_settings.cache_clear()


def _project_with_video(session_factory: sessionmaker, projects_dir: Path) -> str:
    with session_factory() as session:
        project = Project(
            title="Audio con microcorte",
            church_name="Iglesia",
            youtube_channel="canal",
            video_filename="original.mp4",
            duration_seconds=1,
            status=ProjectStatus.ready,
        )
        session.add(project)
        session.commit()
        project_dir = projects_dir / str(project.id)
        project_dir.mkdir()
        (project_dir / "original.mp4").write_bytes(b"source")
        return str(project.id)


def test_audio_repair_endpoints(audio_repair_client) -> None:
    client, session_factory, projects_dir = audio_repair_client
    project_id = _project_with_video(session_factory, projects_dir)

    response = client.post(
        f"/api/projects/{project_id}/audio-repair",
        json={
            "silence_threshold": 8,
            "min_dropout_ms": 2,
            "max_auto_repair_ms": 60,
            "max_review_ms": 250,
        },
    )
    assert response.status_code == 202, response.text
    body = response.json()
    assert body["status"] == "completed"
    assert body["issue_count"] == 1
    assert body["repaired_count"] == 1
    assert body["issues"][0]["repaired"] is True

    latest = client.get(f"/api/projects/{project_id}/audio-repair")
    assert latest.status_code == 200
    assert latest.json()["id"] == body["id"]

    audio = client.get(f"/api/audio-repair-jobs/{body['id']}/audio")
    assert audio.status_code == 200
    assert audio.headers["content-type"].startswith("audio/wav")

    video = client.get(f"/api/audio-repair-jobs/{body['id']}/video")
    assert video.status_code == 200
    assert video.content == b"repaired-video"


def test_audio_repair_requires_video(audio_repair_client) -> None:
    client, session_factory, _projects_dir = audio_repair_client
    with session_factory() as session:
        project = Project(
            title="Sin video",
            church_name="Iglesia",
            youtube_channel="canal",
            status=ProjectStatus.created,
        )
        session.add(project)
        session.commit()
        project_id = project.id

    response = client.post(f"/api/projects/{project_id}/audio-repair", json={})
    assert response.status_code == 400
    assert response.json()["code"] == "video_missing"


def test_audio_repair_accepts_review_items(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    projects_dir = tmp_path / "projects"
    temp_dir = tmp_path / "temp"
    projects_dir.mkdir()
    temp_dir.mkdir()
    monkeypatch.setattr(paths, "PROJECTS_DIR", projects_dir)
    monkeypatch.setattr(paths, "TEMP_DIR", temp_dir)

    url = f"sqlite:///{(tmp_path / 'test.db').as_posix()}"
    monkeypatch.setenv("SERMON_CUT_DATABASE_URL", url)
    monkeypatch.setenv("SERMON_CUT_AUTO_MIGRATE", "false")
    get_settings.cache_clear()
    engine = create_engine(url, connect_args={"check_same_thread": False}, poolclass=StaticPool)
    testing_session = sessionmaker(bind=engine, autoflush=False, autocommit=False)
    Base.metadata.create_all(engine)

    def override_db() -> Generator[Session, None, None]:
        session = testing_session()
        try:
            yield session
        finally:
            session.close()

    manager = AudioRepairManager(
        session_factory=testing_session,
        executor=InlineExecutor(),
        extractor=_fake_extractor_with_review_gap,
        muxer=_fake_muxer,
    )
    app = create_app()
    app.dependency_overrides[get_db] = override_db
    app.dependency_overrides[get_audio_repair_manager] = lambda: manager
    try:
        with TestClient(app) as client:
            project_id = _project_with_video(testing_session, projects_dir)

            conservative = client.post(
                f"/api/projects/{project_id}/audio-repair",
                json={
                    "silence_threshold": 8,
                    "min_dropout_ms": 2,
                    "max_auto_repair_ms": 60,
                    "max_review_ms": 250,
                    "repair_review_items": False,
                },
            )
            assert conservative.status_code == 202, conservative.text
            body = conservative.json()
            assert body["issue_count"] == 2
            assert body["repaired_count"] == 1
            assert body["review_count"] == 1

            accepted = client.post(
                f"/api/projects/{project_id}/audio-repair",
                json={
                    "silence_threshold": 8,
                    "min_dropout_ms": 2,
                    "max_auto_repair_ms": 60,
                    "max_review_ms": 250,
                    "repair_review_items": True,
                },
            )
            assert accepted.status_code == 202, accepted.text
            accepted_body = accepted.json()
            assert accepted_body["issue_count"] == 2
            assert accepted_body["repaired_count"] == 2
            assert accepted_body["review_count"] == 0
            assert accepted_body["max_auto_repair_ms"] == 250
            assert all(issue["repaired"] for issue in accepted_body["issues"])
    finally:
        app.dependency_overrides.clear()
        Base.metadata.drop_all(engine)
        engine.dispose()
        get_settings.cache_clear()
