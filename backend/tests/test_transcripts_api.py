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


def test_editing_segment_text_updates_word_level_captions(client: TestClient) -> None:
    project = _create_project(client)
    content = (FIXTURES / "sample.json").read_bytes()
    uploaded = client.post(
        f"/api/projects/{project['id']}/transcript",
        files={"file": ("sample.json", content, "application/json")},
    )
    assert uploaded.status_code == 201
    segment = uploaded.json()["segments"][0]
    original_times = [
        (word["start_seconds"], word["end_seconds"]) for word in segment["words"]
    ]

    same_count = client.patch(
        f"/api/transcripts/segments/{segment['id']}",
        json={"text": "Palabra corregida aquí"},
    )
    assert same_count.status_code == 200
    edited = same_count.json()["segments"][0]
    assert [word["text"] for word in edited["words"]] == [
        "Palabra",
        "corregida",
        "aquí",
    ]
    assert [
        (word["start_seconds"], word["end_seconds"]) for word in edited["words"]
    ] == original_times

    different_count = client.patch(
        f"/api/transcripts/segments/{segment['id']}",
        json={"text": "Una frase corregida con más palabras"},
    )
    assert different_count.status_code == 200
    rebuilt = different_count.json()["segments"][0]["words"]
    assert [word["text"] for word in rebuilt] == [
        "Una",
        "frase",
        "corregida",
        "con",
        "más",
        "palabras",
    ]
    assert rebuilt[0]["start_seconds"] == 10.2
    assert rebuilt[-1]["end_seconds"] == 14.8


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
    fake_mp4 = b"\x00\x00\x00\x18ftypisom\x00\x00\x00\x00isomiso2mp41"

    with patch("app.services.projects.probe_video", return_value=FAKE_METADATA):
        upload = client.post(
            f"/api/projects/{project_id}/video",
            files={"file": ("sermon.mp4", fake_mp4, "video/mp4")},
        )
    assert upload.status_code == 200

    streamed = client.get(f"/api/projects/{project_id}/media/video")
    assert streamed.status_code == 200
    assert streamed.headers["content-type"].startswith("video/")
    assert streamed.content == fake_mp4
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


def test_valid_timing_edit_and_word_remap(client: TestClient) -> None:
    project = _create_project(client)
    content = (FIXTURES / "sample.json").read_bytes()
    uploaded = client.post(
        f"/api/projects/{project['id']}/transcript",
        files={"file": ("sample.json", content, "application/json")},
    )
    assert uploaded.status_code == 201
    segment = uploaded.json()["segments"][0]
    assert segment["start_seconds"] == 10.2
    assert segment["end_seconds"] == 14.8

    patched = client.patch(
        f"/api/transcripts/segments/{segment['id']}",
        json={"start_seconds": 10.0, "end_seconds": 14.0},
    )
    assert patched.status_code == 200, patched.text
    edited = patched.json()["segments"][0]
    assert edited["start_seconds"] == 10.0
    assert edited["end_seconds"] == 14.0
    words = edited["words"]
    assert words[0]["start_seconds"] == 10.0
    assert words[-1]["end_seconds"] == 14.0
    assert all(10.0 <= w["start_seconds"] <= 14.0 for w in words)
    assert all(10.0 <= w["end_seconds"] <= 14.0 for w in words)


def test_start_greater_or_equal_end_rejected(client: TestClient) -> None:
    project = _create_project(client)
    created = _upload_srt(client, project["id"])
    segment_id = created["segments"][0]["id"]
    response = client.patch(
        f"/api/transcripts/segments/{segment_id}",
        json={"start_seconds": 5.0, "end_seconds": 5.0},
    )
    assert response.status_code == 400
    assert response.json()["code"] == "invalid_time_range"
    assert "inicio" in response.json()["detail"].lower()


def test_non_finite_timing_rejected(client: TestClient) -> None:
    project = _create_project(client)
    created = _upload_srt(client, project["id"])
    segment_id = created["segments"][0]["id"]
    # Pydantic rejects non-finite floats before our validator in most paths;
    # sending a string that coerces poorly should still fail validation.
    response = client.patch(
        f"/api/transcripts/segments/{segment_id}",
        json={"start_seconds": "NaN", "end_seconds": 4.0},
    )
    assert response.status_code == 422


def test_overlap_previous_adjusts_shared_boundary(client: TestClient) -> None:
    project = _create_project(client)
    created = _upload_srt(client, project["id"])
    segments = created["segments"]
    # sample.srt: [1–4.5], [4.5–8.2], [8.2–12]
    mid = segments[1]
    response = client.patch(
        f"/api/transcripts/segments/{mid['id']}",
        json={"start_seconds": 4.0, "end_seconds": 8.2},
    )
    assert response.status_code == 200, response.text
    body = response.json()["segments"]
    assert body[0]["end_seconds"] == 4.0
    assert body[1]["start_seconds"] == 4.0
    assert body[1]["end_seconds"] == 8.2
    assert body[2]["start_seconds"] == 8.2


def test_overlap_next_adjusts_shared_boundary(client: TestClient) -> None:
    project = _create_project(client)
    created = _upload_srt(client, project["id"])
    segments = created["segments"]
    mid = segments[1]
    response = client.patch(
        f"/api/transcripts/segments/{mid['id']}",
        json={"start_seconds": 4.5, "end_seconds": 9.0},
    )
    assert response.status_code == 200, response.text
    body = response.json()["segments"]
    assert body[1]["end_seconds"] == 9.0
    assert body[2]["start_seconds"] == 9.0


def test_unsafe_neighbor_adjust_rejected(client: TestClient) -> None:
    project = _create_project(client)
    created = _upload_srt(client, project["id"])
    mid = created["segments"][1]
    # Would swallow the entire previous segment (previous starts at 1.0).
    response = client.patch(
        f"/api/transcripts/segments/{mid['id']}",
        json={"start_seconds": 0.5, "end_seconds": 8.2},
    )
    assert response.status_code == 400
    assert response.json()["code"] == "unsafe_neighbor_adjust"


def test_beyond_video_duration_rejected(client: TestClient, storage_root: Path) -> None:
    project = _create_project(client)
    project_id = project["id"]
    fake_mp4 = b"\x00\x00\x00\x18ftypisom\x00\x00\x00\x00isomiso2mp41"
    with patch("app.services.projects.probe_video", return_value=FAKE_METADATA):
        upload = client.post(
            f"/api/projects/{project_id}/video",
            files={"file": ("sermon.mp4", fake_mp4, "video/mp4")},
        )
    assert upload.status_code == 200
    created = _upload_srt(client, project_id)
    last = created["segments"][-1]
    response = client.patch(
        f"/api/transcripts/segments/{last['id']}",
        json={"start_seconds": 8.2, "end_seconds": 90.0},
    )
    assert response.status_code == 400
    assert response.json()["code"] == "beyond_video_duration"