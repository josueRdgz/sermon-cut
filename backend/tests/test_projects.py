"""API tests for preaching project CRUD and media uploads."""

from __future__ import annotations

from pathlib import Path
from unittest.mock import patch
from uuid import UUID

from app.services.ffprobe import VideoMetadata
from fastapi.testclient import TestClient

SAMPLE_PROJECT = {
    "title": "La gracia de Dios",
    "preacher_name": "Juan Pérez",
    "bible_reference": "Efesios 2:8-9",
    "church_name": "Iglesia Central",
    "youtube_channel": "@iglesiacentral",
    "full_sermon_url": "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
}

FAKE_METADATA = VideoMetadata(
    duration_seconds=125.5,
    width=1920,
    height=1080,
    fps=29.97,
    video_codec="h264",
    audio_codec="aac",
)


def _create_project(client: TestClient, **overrides: object) -> dict:
    payload = {**SAMPLE_PROJECT, **overrides}
    response = client.post("/api/projects", json=payload)
    assert response.status_code == 201, response.text
    return response.json()


def test_create_and_list_projects(client: TestClient) -> None:
    created = _create_project(client)
    assert created["status"] == "created"
    assert created["has_video"] is False
    assert UUID(created["id"])

    listed = client.get("/api/projects")
    assert listed.status_code == 200
    body = listed.json()
    assert body["total"] == 1
    assert body["items"][0]["title"] == SAMPLE_PROJECT["title"]


def test_get_update_delete_project(client: TestClient, storage_root: Path) -> None:
    created = _create_project(client)
    project_id = created["id"]

    got = client.get(f"/api/projects/{project_id}")
    assert got.status_code == 200
    assert got.json()["church_name"] == "Iglesia Central"

    patched = client.patch(
        f"/api/projects/{project_id}",
        json={"title": "Título actualizado", "preacher_name": None},
    )
    assert patched.status_code == 200
    assert patched.json()["title"] == "Título actualizado"

    project_folder = storage_root / project_id
    assert project_folder.is_dir()

    deleted = client.delete(f"/api/projects/{project_id}")
    assert deleted.status_code == 204
    assert client.get(f"/api/projects/{project_id}").status_code == 404
    assert not project_folder.exists()


def test_get_missing_project_returns_structured_error(client: TestClient) -> None:
    response = client.get("/api/projects/00000000-0000-0000-0000-000000000001")
    assert response.status_code == 404
    body = response.json()
    assert body["code"] == "project_not_found"
    assert "detail" in body


def test_upload_video_and_cover(client: TestClient, storage_root: Path) -> None:
    created = _create_project(client)
    project_id = created["id"]

    with patch("app.services.projects.probe_video", return_value=FAKE_METADATA):
        video_response = client.post(
            f"/api/projects/{project_id}/video",
            files={"file": ("sermon.mp4", b"\x00\x00fake-video-bytes", "video/mp4")},
        )
    assert video_response.status_code == 200, video_response.text
    video_body = video_response.json()
    assert video_body["status"] == "ready"
    assert video_body["has_video"] is True
    assert video_body["video_filename"] == "original.mp4"
    assert video_body["duration_seconds"] == 125.5
    assert video_body["resolution"] == "1920x1080"
    assert video_body["fps"] == 29.97
    assert video_body["video_codec"] == "h264"
    assert video_body["audio_codec"] == "aac"
    assert (storage_root / project_id / "original.mp4").is_file()

    cover_response = client.post(
        f"/api/projects/{project_id}/cover",
        files={"file": ("portada.jpg", b"\xff\xd8\xfffake-jpeg", "image/jpeg")},
    )
    assert cover_response.status_code == 200, cover_response.text
    cover_body = cover_response.json()
    assert cover_body["has_cover"] is True
    assert cover_body["cover_filename"] == "cover.jpg"
    assert (storage_root / project_id / "cover.jpg").is_file()


def test_upload_rejects_unsupported_extension(client: TestClient) -> None:
    created = _create_project(client)
    response = client.post(
        f"/api/projects/{created['id']}/video",
        files={"file": ("clip.avi", b"data", "video/x-msvideo")},
    )
    assert response.status_code == 400
    assert response.json()["code"] == "unsupported_extension"


def test_upload_rejects_oversized_file(client: TestClient) -> None:
    created = _create_project(client)
    # Fixture sets max upload to 1 MiB.
    too_big = b"x" * (1024 * 1024 + 1)
    response = client.post(
        f"/api/projects/{created['id']}/video",
        files={"file": ("big.mp4", too_big, "video/mp4")},
    )
    assert response.status_code == 400
    assert response.json()["code"] == "file_too_large"


def test_upload_rejects_path_traversal_filename(client: TestClient, storage_root: Path) -> None:
    created = _create_project(client)
    project_id = created["id"]

    with patch("app.services.projects.probe_video", return_value=FAKE_METADATA):
        response = client.post(
            f"/api/projects/{project_id}/video",
            files={"file": ("../../evil.mp4", b"data", "video/mp4")},
        )
    assert response.status_code == 200
    # Stored under the project folder with a sanitized canonical name.
    assert response.json()["video_filename"] == "original.mp4"
    assert (storage_root / project_id / "original.mp4").is_file()
    assert not (storage_root / "evil.mp4").exists()


def test_create_requires_title(client: TestClient) -> None:
    payload = {**SAMPLE_PROJECT, "title": ""}
    response = client.post("/api/projects", json=payload)
    assert response.status_code == 422
