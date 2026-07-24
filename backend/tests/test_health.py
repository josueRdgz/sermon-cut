"""Tests for the GET /api/health endpoint."""

from __future__ import annotations

import os

os.environ["SERMON_CUT_AUTO_MIGRATE"] = "false"

from app.core.config import get_settings
from app.main import create_app
from fastapi.testclient import TestClient

get_settings.cache_clear()
client = TestClient(create_app())


def test_health_returns_ok() -> None:
    response = client.get("/api/health")
    assert response.status_code == 200

    body = response.json()
    assert body["status"] == "ok"
    assert body["app_name"]


def test_health_reports_tools_shape() -> None:
    body = client.get("/api/health").json()

    for tool in ("ffmpeg", "ffprobe", "whisper", "gemini"):
        assert tool in body
        assert isinstance(body[tool]["available"], bool)
        # version is either a string or null.
        assert body[tool]["version"] is None or isinstance(body[tool]["version"], str)


def test_health_reports_version_and_storage() -> None:
    body = client.get("/api/health").json()

    assert isinstance(body["version"], str) and body["version"]
    storage = body["storage"]
    assert isinstance(storage["bytes_used"], int)
    assert isinstance(storage["project_count"], int)
