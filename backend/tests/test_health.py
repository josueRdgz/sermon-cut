"""Tests for the GET /api/health endpoint."""

from __future__ import annotations

from app.main import create_app
from fastapi.testclient import TestClient

client = TestClient(create_app())


def test_health_returns_ok() -> None:
    response = client.get("/api/health")
    assert response.status_code == 200

    body = response.json()
    assert body["status"] == "ok"
    assert body["app_name"]


def test_health_reports_tools_shape() -> None:
    body = client.get("/api/health").json()

    for tool in ("ffmpeg", "ffprobe"):
        assert tool in body
        assert isinstance(body[tool]["available"], bool)
        # version is either a string or null.
        assert body[tool]["version"] is None or isinstance(body[tool]["version"], str)
