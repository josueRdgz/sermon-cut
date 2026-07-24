"""Shared pytest fixtures for API and storage tests."""

from __future__ import annotations

from collections.abc import Generator
from pathlib import Path

import pytest
from app.core.config import get_settings
from app.db.base import Base
from app.db.session import get_db
from app.main import create_app
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool


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
    get_settings.cache_clear()

    engine = create_engine(
        url,
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    TestingSessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False)
    Base.metadata.create_all(bind=engine)

    yield TestingSessionLocal

    Base.metadata.drop_all(bind=engine)
    engine.dispose()
    get_settings.cache_clear()


@pytest.fixture()
def client(
    db_session_factory: sessionmaker,
) -> Generator[TestClient, None, None]:
    """HTTP client bound to an isolated SQLite database and storage tree."""

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
