"""API tests for end card settings, assets and preview."""

from __future__ import annotations

import io

from fastapi.testclient import TestClient
from PIL import Image

SAMPLE_PROJECT = {
    "title": "La suficiencia de Cristo",
    "church_name": "Iglesia Central",
    "youtube_channel": "@iglesiacentral",
    "full_sermon_url": "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
}


def _create_project(client: TestClient) -> str:
    response = client.post("/api/projects", json=SAMPLE_PROJECT)
    assert response.status_code == 201, response.text
    return response.json()["id"]


def _png_bytes(size: tuple[int, int] = (64, 64)) -> bytes:
    buffer = io.BytesIO()
    Image.new("RGB", size, (200, 40, 40)).save(buffer, format="PNG")
    return buffer.getvalue()


def test_layouts_expose_the_three_designs(client: TestClient) -> None:
    response = client.get("/api/end-card/layouts")
    assert response.status_code == 200
    ids = {item["id"] for item in response.json()["items"]}
    assert ids == {"cover_full", "cover_card", "minimal"}


def test_defaults_are_five_seconds_with_the_documented_fades(client: TestClient) -> None:
    response = client.get("/api/end-card/settings")
    assert response.status_code == 200
    body = response.json()
    assert body["duration_seconds"] == 5.0
    assert body["fade_in_ms"] == 300
    assert body["audio_fade_out_ms"] == 500
    assert body["is_mandatory"] is True
    assert body["min_duration_seconds"] == 3.0
    assert body["max_duration_seconds"] == 8.0


def test_project_inherits_global_settings_until_overridden(client: TestClient) -> None:
    project_id = _create_project(client)

    saved = client.put(
        "/api/end-card/settings",
        json={"layout": "minimal", "duration_seconds": 7.0},
    )
    assert saved.status_code == 200

    inherited = client.get(f"/api/projects/{project_id}/end-card/settings").json()
    assert inherited["layout"] == "minimal"
    assert inherited["duration_seconds"] == 7.0
    assert inherited["is_project_override"] is False

    overridden = client.put(
        f"/api/projects/{project_id}/end-card/settings",
        json={"layout": "cover_card", "duration_seconds": 4.0},
    )
    assert overridden.status_code == 200
    assert overridden.json()["layout"] == "cover_card"
    assert overridden.json()["is_project_override"] is True

    # The global row is untouched.
    assert client.get("/api/end-card/settings").json()["layout"] == "minimal"

    reset = client.delete(f"/api/projects/{project_id}/end-card/settings")
    assert reset.status_code == 200
    assert reset.json()["layout"] == "minimal"
    assert reset.json()["is_project_override"] is False


def test_duration_outside_the_allowed_window_is_rejected(client: TestClient) -> None:
    project_id = _create_project(client)
    for seconds in (2.0, 9.0):
        response = client.put(
            f"/api/projects/{project_id}/end-card/settings",
            json={"duration_seconds": seconds},
        )
        assert response.status_code == 422, response.text


def test_local_music_mode_requires_an_uploaded_file(client: TestClient) -> None:
    project_id = _create_project(client)
    rejected = client.put(
        f"/api/projects/{project_id}/end-card/settings",
        json={"audio_mode": "local_music"},
    )
    assert rejected.status_code == 400
    assert rejected.json()["code"] == "end_card_music_missing"

    uploaded = client.post(
        f"/api/projects/{project_id}/end-card/music",
        files={"file": ("bed.mp3", b"ID3\x03\x00\x00\x00\x00\x00\x00fake-audio", "audio/mpeg")},
    )
    assert uploaded.status_code == 200, uploaded.text
    assert uploaded.json()["music_filename"] == "end-card-music.mp3"

    accepted = client.put(
        f"/api/projects/{project_id}/end-card/settings",
        json={"audio_mode": "local_music", "music_volume": 0.3},
    )
    assert accepted.status_code == 200
    assert accepted.json()["audio_mode"] == "local_music"


def test_music_upload_rejects_unsupported_formats(client: TestClient) -> None:
    project_id = _create_project(client)
    response = client.post(
        f"/api/projects/{project_id}/end-card/music",
        files={"file": ("bed.txt", b"not audio", "text/plain")},
    )
    assert response.status_code == 400
    assert response.json()["code"] == "unsupported_extension"


def test_logo_upload_is_stored_and_reported(client: TestClient) -> None:
    project_id = _create_project(client)
    response = client.post(
        f"/api/projects/{project_id}/end-card/logo",
        files={"file": ("logo.png", _png_bytes(), "image/png")},
    )
    assert response.status_code == 200, response.text
    assert response.json()["logo_filename"] == "end-card-logo.png"


def test_preview_returns_a_png_at_the_requested_aspect_ratio(client: TestClient) -> None:
    project_id = _create_project(client)
    client.post(
        f"/api/projects/{project_id}/cover",
        files={"file": ("cover.png", _png_bytes((320, 180)), "image/png")},
    )

    response = client.get(
        f"/api/projects/{project_id}/end-card/preview",
        params={"aspect_ratio": "9:16", "scale": 0.25},
    )
    assert response.status_code == 200
    assert response.headers["content-type"] == "image/png"
    with Image.open(io.BytesIO(response.content)) as image:
        assert image.size == (270, 480)


def test_preview_can_override_the_layout_without_saving(client: TestClient) -> None:
    project_id = _create_project(client)
    response = client.get(
        f"/api/projects/{project_id}/end-card/preview",
        params={"layout": "minimal", "scale": 0.25},
    )
    assert response.status_code == 200
    assert client.get(f"/api/projects/{project_id}/end-card/settings").json()[
        "layout"
    ] == "cover_full"
