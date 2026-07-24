"""API tests for the optional YouTube import endpoints (no network)."""

from __future__ import annotations

from pathlib import Path

import pytest
from app.services.ffprobe import VideoMetadata
from app.services.youtube.manager import (
    InlineExecutor,
    YouTubeImportManager,
    get_youtube_import_manager,
)
from app.services.youtube.ytdlp import DownloadResult
from fastapi.testclient import TestClient
from sqlalchemy.orm import sessionmaker

_MP4_MAGIC = b"\x00\x00\x00\x18ftypmp42" + b"\x00" * 48

_PAYLOAD = {
    "id": "dQw4w9WgXcQ",
    "title": "Sermón de prueba",
    "channel": "Iglesia Demo",
    "duration": 1800,
    "thumbnail": "https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg",
    "upload_date": "20240115",
    "formats": [
        {"vcodec": "avc1.640028", "acodec": "none", "height": 1080, "filesize": 1000},
        {"vcodec": "none", "acodec": "mp4a.40.2", "filesize": 200},
    ],
}


def _create_project(client: TestClient) -> str:
    resp = client.post(
        "/api/projects",
        json={"title": "Demo", "church_name": "Iglesia Demo", "youtube_channel": "@demo"},
    )
    assert resp.status_code == 201
    return resp.json()["id"]


def test_preview_success(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr("app.services.youtube.manager.require_ytdlp", lambda _s: "yt-dlp")
    monkeypatch.setattr(
        "app.services.youtube.manager.run_metadata",
        lambda *a, **k: (0, _PAYLOAD, ""),
    )

    resp = client.post("/api/youtube/preview", json={"url": "https://youtu.be/dQw4w9WgXcQ"})
    assert resp.status_code == 200
    body = resp.json()
    assert body["video_id"] == "dQw4w9WgXcQ"
    assert body["title"] == "Sermón de prueba"
    assert body["resolution_label"] == "1080p"


def test_preview_rejects_playlist(client: TestClient) -> None:
    resp = client.post(
        "/api/youtube/preview",
        json={"url": "https://www.youtube.com/playlist?list=PL123"},
    )
    assert resp.status_code == 400
    assert resp.json()["code"] == "youtube_playlist"


def test_preview_rejects_non_youtube(client: TestClient) -> None:
    resp = client.post("/api/youtube/preview", json={"url": "https://vimeo.com/12345"})
    assert resp.status_code == 400
    assert resp.json()["code"] == "youtube_not_youtube"


def test_import_rejects_bad_url(client: TestClient) -> None:
    project_id = _create_project(client)
    resp = client.post(
        f"/api/projects/{project_id}/youtube-import",
        json={"url": "file:///etc/passwd", "quality": "1080p"},
    )
    assert resp.status_code == 400
    assert resp.json()["code"] == "youtube_bad_scheme"


def test_import_missing_project_returns_404(client: TestClient) -> None:
    resp = client.post(
        "/api/projects/00000000-0000-0000-0000-000000000000/youtube-import",
        json={"url": "https://youtu.be/dQw4w9WgXcQ", "quality": "1080p"},
    )
    assert resp.status_code == 404


def test_import_happy_path_and_poll(
    client: TestClient,
    db_session_factory: sessionmaker,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(
        "app.services.projects.probe_video",
        lambda _p: VideoMetadata(1800.0, 1920, 1080, 30.0, "h264", "aac"),
    )

    def fake_download(exe, url, *, format_selector, output_template, on_progress, cancel_event, log_path):  # noqa: ANN001, ANN201, E501
        out = Path(output_template.replace("%(ext)s", "mp4"))
        out.write_bytes(_MP4_MAGIC)
        return DownloadResult(0, False, "", out, True)

    fake_manager = YouTubeImportManager(
        session_factory=db_session_factory,
        executor=InlineExecutor(),
        ytdlp_locator=lambda _s: "yt-dlp",
        downloader=fake_download,
        metadata_runner=lambda *a, **k: (0, _PAYLOAD, ""),
    )
    client.app.dependency_overrides[get_youtube_import_manager] = lambda: fake_manager

    project_id = _create_project(client)
    resp = client.post(
        f"/api/projects/{project_id}/youtube-import",
        json={"url": "https://youtu.be/dQw4w9WgXcQ", "quality": "1080p"},
    )
    assert resp.status_code == 202
    job = resp.json()
    # InlineExecutor ran the job synchronously; it should already be complete.
    assert job["status"] == "completed"
    assert job["output_filename"] == "youtube-dQw4w9WgXcQ.mp4"

    poll = client.get(f"/api/youtube-import-jobs/{job['id']}")
    assert poll.status_code == 200
    assert poll.json()["status"] == "completed"

    project = client.get(f"/api/projects/{project_id}").json()
    assert project["status"] == "ready"
    assert project["has_video"] is True

    client.app.dependency_overrides.pop(get_youtube_import_manager, None)
