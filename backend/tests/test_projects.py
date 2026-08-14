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

# Minimal ISO BMFF / JPEG headers that pass assert_file_magic (probe is mocked).
FAKE_MP4 = b"\x00\x00\x00\x18ftypisom\x00\x00\x00\x00isomiso2mp41"
FAKE_JPEG = b"\xff\xd8\xff\xe0\x00\x10JFIF" + b"\x00" * 8

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
    # Metadata-only projects no longer create empty storage folders.
    assert not project_folder.exists()

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
            files={"file": ("sermon.mp4", FAKE_MP4, "video/mp4")},
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
    assert video_body["source_kind"] == "sermon_only"
    assert video_body["sermon_range_confirmed"] is True
    assert video_body["sermon_start_seconds"] == 0.0
    assert video_body["sermon_end_seconds"] == 125.5

    cover_response = client.post(
        f"/api/projects/{project_id}/cover",
        files={"file": ("portada.jpg", FAKE_JPEG, "image/jpeg")},
    )
    assert cover_response.status_code == 200, cover_response.text
    cover_body = cover_response.json()
    assert cover_body["has_cover"] is True
    assert cover_body["cover_filename"] == "cover.jpg"
    assert (storage_root / project_id / "cover.jpg").is_file()

    deleted_video = client.delete(f"/api/projects/{project_id}/video")
    assert deleted_video.status_code == 200, deleted_video.text
    deleted_body = deleted_video.json()
    assert deleted_body["has_video"] is False
    assert deleted_body["duration_seconds"] is None
    assert deleted_body["resolution"] is None
    assert not (storage_root / project_id / "original.mp4").exists()
    assert (storage_root / project_id / "cover.jpg").is_file()


def test_background_music_can_be_streamed_for_start_selection(client: TestClient) -> None:
    created = _create_project(client)
    fake_mp3 = b"ID3\x03\x00\x00\x00\x00\x00\x00preview-audio"
    uploaded = client.post(
        f"/api/projects/{created['id']}/background-music/upload",
        files={"file": ("music.mp3", fake_mp3, "audio/mpeg")},
    )
    assert uploaded.status_code == 200, uploaded.text

    streamed = client.get(
        f"/api/projects/{created['id']}/background-music/audio"
    )
    assert streamed.status_code == 200
    assert streamed.headers["content-type"].startswith("audio/mpeg")
    assert streamed.headers["cache-control"] == "no-store"
    assert streamed.content == fake_mp3

    partial = client.get(
        f"/api/projects/{created['id']}/background-music/audio",
        headers={"Range": "bytes=0-9"},
    )
    assert partial.status_code == 206
    assert partial.headers["accept-ranges"] == "bytes"
    assert partial.content == fake_mp3[:10]


def test_upload_rejects_unsupported_extension(client: TestClient) -> None:
    created = _create_project(client)
    response = client.post(
        f"/api/projects/{created['id']}/video",
        files={"file": ("clip.avi", b"data", "video/x-msvideo")},
    )
    assert response.status_code == 400
    assert response.json()["code"] == "unsupported_extension"


def test_upload_rejects_oversized_file(client: TestClient, storage_root: Path) -> None:
    created = _create_project(client)
    # Fixture sets max upload to 1 MiB.
    too_big = b"x" * (1024 * 1024 + 1)
    response = client.post(
        f"/api/projects/{created['id']}/video",
        files={"file": ("big.mp4", too_big, "video/mp4")},
    )
    assert response.status_code == 400
    assert response.json()["code"] == "file_too_large"
    assert not (storage_root / created["id"]).exists()


def test_prune_removes_only_fileless_project_trees(storage_root: Path) -> None:
    from uuid import uuid4

    from app.services.storage import prune_empty_project_dirs

    empty = storage_root / str(uuid4())
    (empty / "renders" / ".tmp").mkdir(parents=True)
    occupied = storage_root / str(uuid4())
    occupied.mkdir()
    (occupied / "keep.txt").write_text("keep")
    unrelated = storage_root / "not-a-project"
    unrelated.mkdir()

    assert prune_empty_project_dirs() == 1
    assert not empty.exists()
    assert occupied.is_dir()
    assert unrelated.is_dir()


def test_upload_rejects_path_traversal_filename(client: TestClient, storage_root: Path) -> None:
    created = _create_project(client)
    project_id = created["id"]

    with patch("app.services.projects.probe_video", return_value=FAKE_METADATA):
        response = client.post(
            f"/api/projects/{project_id}/video",
            files={"file": ("../../evil.mp4", FAKE_MP4, "video/mp4")},
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


def test_create_full_service_waits_for_sermon_range(client: TestClient) -> None:
    created = _create_project(client, source_kind="full_service")
    assert created["source_kind"] == "full_service"
    assert created["sermon_range_confirmed"] is False

    with patch("app.services.projects.probe_video", return_value=FAKE_METADATA):
        uploaded = client.post(
            f"/api/projects/{created['id']}/video",
            files={"file": ("culto.mp4", FAKE_MP4, "video/mp4")},
        )
    body = uploaded.json()
    assert body["sermon_range_confirmed"] is False
    assert body["sermon_end_seconds"] == 125.5


def test_apply_sermon_range_keeps_full_file_when_window_is_the_whole_video(
    client: TestClient, storage_root: Path
) -> None:
    created = _create_project(client, source_kind="full_service")
    project_id = created["id"]
    with patch("app.services.projects.probe_video", return_value=FAKE_METADATA):
        client.post(
            f"/api/projects/{project_id}/video",
            files={"file": ("culto.mp4", FAKE_MP4, "video/mp4")},
        )
        confirmed = client.post(
            f"/api/projects/{project_id}/sermon-range",
            json={"start_seconds": 0, "end_seconds": 125.5},
        )
    assert confirmed.status_code == 200, confirmed.text
    body = confirmed.json()
    assert body["sermon_range_confirmed"] is True
    assert body["video_filename"] == "original.mp4"
    assert (storage_root / project_id / "original.mp4").is_file()


def test_apply_sermon_range_trims_working_video(client: TestClient, storage_root: Path) -> None:
    created = _create_project(client, source_kind="full_service")
    project_id = created["id"]
    with patch("app.services.projects.probe_video", return_value=FAKE_METADATA):
        client.post(
            f"/api/projects/{project_id}/video",
            files={"file": ("culto.mp4", FAKE_MP4, "video/mp4")},
        )

    trimmed = VideoMetadata(
        duration_seconds=40.0,
        width=1920,
        height=1080,
        fps=29.97,
        video_codec="h264",
        audio_codec="aac",
    )

    def fake_extract(source, destination, *, start, end) -> None:  # noqa: ANN001
        destination.write_bytes(FAKE_MP4)
        assert start == 20.0
        assert end == 60.0

    with (
        patch("app.services.projects.extract_window", side_effect=fake_extract),
        patch("app.services.projects.probe_video", return_value=trimmed),
    ):
        response = client.post(
            f"/api/projects/{project_id}/sermon-range",
            json={"start_seconds": 20, "end_seconds": 60},
        )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["video_filename"] == "sermon.mp4"
    assert body["duration_seconds"] == 40.0
    assert body["sermon_range_confirmed"] is True
    assert body["sermon_start_seconds"] == 0.0
    assert (storage_root / project_id / "sermon.mp4").is_file()
    assert not (storage_root / project_id / "original.mp4").exists()
