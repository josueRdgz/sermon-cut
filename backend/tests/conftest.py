"""Shared pytest fixtures for API and storage tests."""

from __future__ import annotations

import os

# Disable startup migrations before importing the app factory (tests use create_all).
os.environ["SERMON_CUT_AUTO_MIGRATE"] = "false"

from collections.abc import Generator
from pathlib import Path

import pytest
from app.core.config import get_settings
from app.db.base import Base
from app.db.session import get_db
from app.main import create_app
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, event
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

get_settings.cache_clear()


@pytest.fixture()
def storage_root(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    """Isolate project storage under a temporary directory."""
    projects = tmp_path / "projects"
    projects.mkdir()
    monkeypatch.setattr("app.core.paths.PROJECTS_DIR", projects)
    return projects


@pytest.fixture()
def db_session_factory(
    tmp_path: Path,
    storage_root: Path,  # noqa: ARG001 — ensures storage is patched
    monkeypatch: pytest.MonkeyPatch,
) -> Generator[sessionmaker, None, None]:
    """Isolated SQLite session factory shared by the TestClient."""
    db_path = tmp_path / "test.db"
    url = f"sqlite:///{db_path.as_posix()}"
    monkeypatch.setenv("SERMON_CUT_DATABASE_URL", url)
    monkeypatch.setenv("SERMON_CUT_MAX_UPLOAD_BYTES", "1048576")  # 1 MiB for tests
    monkeypatch.setenv("SERMON_CUT_AUTO_MIGRATE", "false")
    get_settings.cache_clear()

    engine = create_engine(
        url,
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )

    @event.listens_for(engine, "connect")
    def _fk_on(dbapi_connection: object, _record: object) -> None:
        cursor = dbapi_connection.cursor()  # type: ignore[attr-defined]
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.close()

    TestingSessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False)
    Base.metadata.create_all(bind=engine)

    yield TestingSessionLocal

    Base.metadata.drop_all(bind=engine)
    engine.dispose()
    get_settings.cache_clear()


@pytest.fixture()
def client(
    db_session_factory: sessionmaker,
    monkeypatch: pytest.MonkeyPatch,
) -> Generator[TestClient, None, None]:
    """HTTP client bound to an isolated SQLite database and storage tree."""

    # Lifespan would otherwise open the process-wide SessionLocal (not the test DB).
    monkeypatch.setattr(
        "app.services.job_recovery.reconcile_stale_jobs",
        lambda _session: {"render": 0, "transcription": 0, "analysis": 0},
    )
    monkeypatch.setattr(
        "app.services.render.manager.RenderManager.shutdown",
        lambda self, wait=False: None,
    )
    monkeypatch.setattr(
        "app.services.whisper.manager.JobManager.shutdown",
        lambda self, wait=False: None,
    )
    monkeypatch.setattr(
        "app.services.analysis.manager.AnalysisManager.shutdown",
        lambda self, wait=False: None,
    )

    def _override_get_db() -> Generator[Session, None, None]:
        db = db_session_factory()
        try:
            yield db
        finally:
            db.close()

    app = create_app()
    app.dependency_overrides[get_db] = _override_get_db

    with TestClient(app) as test_client:
        yield test_client

    app.dependency_overrides.clear()
