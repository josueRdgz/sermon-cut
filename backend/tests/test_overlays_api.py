"""API tests for project assets and reel overlays, including B-roll video."""

from __future__ import annotations

import io
from pathlib import Path
from unittest.mock import patch
from uuid import UUID

from app.models.project import Project
from app.services.ffprobe import VideoMetadata
from fastapi.testclient import TestClient
from PIL import Image
from sqlalchemy.orm import sessionmaker

SAMPLE_PROJECT = {
    "title": "Promesa de restauración",
    "church_name": "Iglesia Central",
    "youtube_channel": "@iglesiacentral",
}

FAKE_MP4 = b"\x00\x00\x00\x18ftypisom\x00\x00\x00\x00isomiso2mp41"
FAKE_METADATA = VideoMetadata(
    duration_seconds=4.5,
    width=1280,
    height=720,
    fps=30.0,
    video_codec="h264",
    audio_codec="aac",
)


def _png_bytes(size: tuple[int, int] = (80, 60)) -> bytes:
    buffer = io.BytesIO()
    Image.new("RGBA", size, (220, 40, 40, 200)).save(buffer, format="PNG")
    return buffer.getvalue()


def _create_project(client: TestClient, session_factory: sessionmaker) -> str:
    response = client.post("/api/projects", json=SAMPLE_PROJECT)
    assert response.status_code == 201, response.text
    project_id = response.json()["id"]
    with session_factory() as db:
        project = db.get(Project, UUID(project_id))
        assert project is not None
        project.duration_seconds = 120.0
        project.video_filename = "original.mp4"
        db.commit()
    return project_id


def _create_reel(client: TestClient, project_id: str) -> str:
    response = client.post(
        f"/api/projects/{project_id}/reels",
        json={
            "title": "Reel de prueba",
            "segments": [
                {
                    "source_start_seconds": 10.0,
                    "source_end_seconds": 20.0,
                    "transcript_text": "fragmento",
                }
            ],
        },
    )
    assert response.status_code == 201, response.text
    return response.json()["id"]


def test_upload_image_and_create_overlay(
    client: TestClient, db_session_factory: sessionmaker, storage_root: Path
) -> None:
    project_id = _create_project(client, db_session_factory)
    reel_id = _create_reel(client, project_id)

    uploaded = client.post(
        f"/api/projects/{project_id}/assets",
        files={"file": ("logo.png", _png_bytes(), "image/png")},
    )
    assert uploaded.status_code == 201, uploaded.text
    asset = uploaded.json()
    assert asset["kind"] == "image"
    assert asset["width"] == 80
    media = client.get(asset["media_url"])
    assert media.status_code == 200
    assert media.headers["content-type"].startswith("image/")

    created = client.post(
        f"/api/projects/{project_id}/reels/{reel_id}/overlays",
        json={"kind": "image", "asset_id": asset["id"], "start_ms": 1000},
    )
    assert created.status_code == 201, created.text
    body = created.json()
    assert body["kind"] == "image"
    assert body["duration_ms"] == 3000
    listed = client.get(f"/api/projects/{project_id}/reels/{reel_id}/overlays")
    assert listed.status_code == 200
    assert listed.json()["total"] == 1

    patched = client.patch(
        f"/api/projects/{project_id}/reels/{reel_id}/overlays/{body['id']}",
        json={"duration_ms": 2500, "x": 0.4},
    )
    assert patched.status_code == 200
    assert patched.json()["duration_ms"] == 2500

    deleted = client.delete(
        f"/api/projects/{project_id}/reels/{reel_id}/overlays/{body['id']}"
    )
    assert deleted.status_code == 204
    assert (storage_root / project_id / asset["filename"]).is_file()


def test_upload_video_broll_and_create_overlay(
    client: TestClient, db_session_factory: sessionmaker
) -> None:
    project_id = _create_project(client, db_session_factory)
    reel_id = _create_reel(client, project_id)

    with patch("app.services.assets.probe_video", return_value=FAKE_METADATA):
        uploaded = client.post(
            f"/api/projects/{project_id}/assets",
            files={"file": ("broll.mp4", FAKE_MP4, "video/mp4")},
        )
    assert uploaded.status_code == 201, uploaded.text
    asset = uploaded.json()
    assert asset["kind"] == "video"
    assert asset["duration_ms"] == 4500

    created = client.post(
        f"/api/projects/{project_id}/reels/{reel_id}/overlays",
        json={"kind": "video", "asset_id": asset["id"], "start_ms": 500},
    )
    assert created.status_code == 201, created.text
    body = created.json()
    assert body["kind"] == "video"
    assert body["duration_ms"] == 4500
    assert body["x"] == 0.78
    assert body["asset_media_url"]


def test_text_overlay_does_not_need_an_asset(
    client: TestClient, db_session_factory: sessionmaker
) -> None:
    project_id = _create_project(client, db_session_factory)
    reel_id = _create_reel(client, project_id)
    created = client.post(
        f"/api/projects/{project_id}/reels/{reel_id}/overlays",
        json={"kind": "text", "text": "Juan 3:16", "start_ms": 0},
    )
    assert created.status_code == 201, created.text
    assert created.json()["text"] == "Juan 3:16"
    assert created.json()["asset_id"] is None


def test_image_overlay_rejects_missing_asset(
    client: TestClient, db_session_factory: sessionmaker
) -> None:
    project_id = _create_project(client, db_session_factory)
    reel_id = _create_reel(client, project_id)
    response = client.post(
        f"/api/projects/{project_id}/reels/{reel_id}/overlays",
        json={"kind": "image", "start_ms": 0},
    )
    assert response.status_code == 400
    assert response.json()["code"] == "asset_required"
