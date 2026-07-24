"""API tests for transcript import, edit, export and video streaming."""

from __future__ import annotations

from pathlib import Path
from unittest.mock import patch

from app.services.ffprobe import VideoMetadata
from fastapi.testclient import TestClient

FIXTURES = Path(__file__).resolve().parent / "fixtures" / "transcripts"

SAMPLE_PROJECT = {
    "title": "La gracia de Dios",
    "church_name": "Iglesia Central",
    "youtube_channel": "@iglesiacentral",
}

FAKE_METADATA = VideoMetadata(
    duration_seconds=60.0,
    width=1280,
    height=720,
    fps=30.0,
    video_codec="h264",
    audio_codec="aac",
)


def _create_project(client: TestClient) -> dict:
    response = client.post("/api/projects", json=SAMPLE_PROJECT)
    assert response.status_code == 201, response.text
    return response.json()


def _upload_srt(client: TestClient, project_id: str) -> dict:
    content = (FIXTURES / "sample.srt").read_bytes()
    response = client.post(
        f"/api/projects/{project_id}/transcript",
        files={"file": ("sample.srt", content, "application/x-subrip")},
        data={"language": "es"},
    )
    assert response.status_code == 201, response.text
    return response.json()


def test_upload_get_edit_export_delete_transcript(client: TestClient) -> None:
    project = _create_project(client)
    project_id = project["id"]

    created = _upload_srt(client, project_id)
    assert created["source"] == "uploaded_srt"
    assert created["status"] == "ready"
    assert created["language"] == "es"
    assert len(created["segments"]) == 3
    assert "Bienvenidos" in created["full_text"]

    fetched = client.get(f"/api/projects/{project_id}/transcript")
    assert fetched.status_code == 200
    assert fetched.json()["id"] == created["id"]

    segment_id = created["segments"][0]["id"]
    patched = client.patch(
        f"/api/transcripts/segments/{segment_id}",
        json={"text": "Bienvenidos editado.", "start_seconds": 1.0, "end_seconds": 4.0},
    )
    assert patched.status_code == 200, patched.text
    assert patched.json()["segments"][0]["text"] == "Bienvenidos editado."
    assert "Bienvenidos editado." in patched.json()["full_text"]

    srt_export = client.get(f"/api/projects/{project_id}/transcript/export", params={"format": "srt"})
    assert srt_export.status_code == 200
    assert "-->" in srt_export.text
    assert "Bienvenidos editado." in srt_export.text

    vtt_export = client.get(f"/api/projects/{project_id}/transcript/export", params={"format": "vtt"})
    assert vtt_export.status_code == 200
    assert vtt_export.text.startswith("WEBVTT")

    json_export = client.get(f"/api/projects/{project_id}/transcript/export", params={"format": "json"})
    assert json_export.status_code == 200
    body = json_export.json()
    assert "segments" in body
    assert body["language"] == "es"

    deleted = client.delete(f"/api/projects/{project_id}/transcript")
    assert deleted.status_code == 204
    assert client.get(f"/api/projects/{project_id}/transcript").status_code == 404


def test_upload_txt_is_unsynced(client: TestClient) -> None:
    project = _create_project(client)
    content = (FIXTURES / "sample.txt").read_bytes()
    response = client.post(
        f"/api/projects/{project['id']}/transcript",
        files={"file": ("sample.txt", content, "text/plain")},
    )
    assert response.status_code == 201, response.text
    body = response.json()
    assert body["source"] == "uploaded_txt"
    assert body["status"] == "unsynced"
    assert body["segments"][0]["start_seconds"] is None

    export = client.get(
        f"/api/projects/{project['id']}/transcript/export",
        params={"format": "srt"},
    )
    assert export.status_code == 400
    assert export.json()["code"] == "unsynced_export"


def test_upload_corrupt_srt_returns_structured_error(client: TestClient) -> None:
    project = _create_project(client)
    content = (FIXTURES / "corrupt_overlap.srt").read_bytes()
    response = client.post(
        f"/api/projects/{project['id']}/transcript",
        files={"file": ("bad.srt", content, "application/x-subrip")},
    )
    assert response.status_code == 400
    assert response.json()["code"] == "overlapping_segments"


def test_stream_video_endpoint(client: TestClient, storage_root: Path) -> None:
    project = _create_project(client)
    project_id = project["id"]

    with patch("app.services.projects.probe_video", return_value=FAKE_METADATA):
        upload = client.post(
            f"/api/projects/{project_id}/video",
            files={"file": ("sermon.mp4", b"\x00\x00fake-video", "video/mp4")},
        )
    assert upload.status_code == 200

    streamed = client.get(f"/api/projects/{project_id}/media/video")
    assert streamed.status_code == 200
    assert streamed.headers["content-type"].startswith("video/")
    assert streamed.content == b"\x00\x00fake-video"
    assert (storage_root / project_id / "original.mp4").is_file()


def test_replace_transcript_on_reupload(client: TestClient) -> None:
    project = _create_project(client)
    first = _upload_srt(client, project["id"])
    second_content = (FIXTURES / "sample.json").read_bytes()
    second = client.post(
        f"/api/projects/{project['id']}/transcript",
        files={"file": ("sample.json", second_content, "application/json")},
    )
    assert second.status_code == 201
    assert second.json()["id"] != first["id"]
    assert second.json()["source"] == "uploaded_json"
    assert len(second.json()["segments"]) == 2
