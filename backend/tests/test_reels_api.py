"""API tests for Reels: CRUD, ordering, and non-contiguous segments."""

from __future__ import annotations

from uuid import UUID, uuid4

import pytest
from app.models.project import Project
from fastapi.testclient import TestClient
from sqlalchemy.orm import sessionmaker


def _create_project_with_duration(
    client: TestClient,
    session_factory: sessionmaker,
    *,
    duration: float = 900.0,
) -> str:
    resp = client.post(
        "/api/projects",
        json={
            "title": "Sermón de prueba",
            "church_name": "Iglesia",
            "youtube_channel": "canal",
        },
    )
    assert resp.status_code == 201, resp.text
    project_id = resp.json()["id"]

    with session_factory() as db:
        project = db.get(Project, UUID(project_id))
        assert project is not None
        project.duration_seconds = duration
        project.video_filename = "original.mp4"
        db.commit()
    return project_id


@pytest.fixture()
def project_with_duration(client: TestClient, db_session_factory: sessionmaker) -> str:
    return _create_project_with_duration(client, db_session_factory)


def test_create_reel_with_non_contiguous_segments(
    client: TestClient, project_with_duration: str
) -> None:
    project_id = project_with_duration
    resp = client.post(
        f"/api/projects/{project_id}/reels",
        json={
            "title": "Gancho + clímax",
            "aspect_ratio": "9:16",
            "segments": [
                {
                    # 00:10:20 – 00:10:42
                    "source_start_seconds": 620.0,
                    "source_end_seconds": 642.0,
                    "transcript_text": "primer fragmento",
                    "transition_type": "hard_cut",
                    "transition_duration_ms": 0,
                },
                {
                    # 00:11:05 – 00:11:29
                    "source_start_seconds": 665.0,
                    "source_end_seconds": 689.0,
                    "transcript_text": "segundo fragmento",
                    "transition_type": "short_crossfade",
                    "transition_duration_ms": 250,
                },
                {
                    # 00:12:01 – 00:12:18
                    "source_start_seconds": 721.0,
                    "source_end_seconds": 738.0,
                    "transcript_text": "tercer fragmento",
                    "transition_type": "hard_cut",
                    "transition_duration_ms": 0,
                },
            ],
        },
    )
    assert resp.status_code == 201, resp.text
    body = resp.json()
    assert len(body["segments"]) == 3
    assert [s["order"] for s in body["segments"]] == [0, 1, 2]
    # Content: 22 + 24 + 17 = 63; crossfade 0.25s *subtracts* from total
    assert body["content_duration_seconds"] == pytest.approx(63.0, abs=0.001)
    assert body["total_duration_seconds"] == pytest.approx(62.75, abs=0.001)
    starts = [s["source_start_seconds"] for s in body["segments"]]
    assert starts == [620.0, 665.0, 721.0]


def test_add_edit_reorder_delete_segments(
    client: TestClient, project_with_duration: str
) -> None:
    project_id = project_with_duration
    created = client.post(
        f"/api/projects/{project_id}/reels",
        json={
            "title": "Borrador",
            "segments": [
                {
                    "source_start_seconds": 1.0,
                    "source_end_seconds": 3.0,
                    "transition_type": "hard_cut",
                    "transition_duration_ms": 0,
                },
                {
                    "source_start_seconds": 10.0,
                    "source_end_seconds": 12.0,
                    "transition_type": "hard_cut",
                    "transition_duration_ms": 0,
                },
            ],
        },
    )
    assert created.status_code == 201, created.text
    reel = created.json()
    reel_id = reel["id"]
    first_id = reel["segments"][0]["id"]
    second_id = reel["segments"][1]["id"]

    added = client.post(
        f"/api/projects/{project_id}/reels/{reel_id}/segments",
        json={
            "source_start_seconds": 40.0,
            "source_end_seconds": 45.5,
            "transcript_text": "otro fragmento",
            "transition_type": "dip_to_black",
            "transition_duration_ms": 400,
        },
    )
    assert added.status_code == 201, added.text
    assert len(added.json()["segments"]) == 3

    edited = client.patch(
        f"/api/projects/{project_id}/reels/{reel_id}/segments/{first_id}",
        json={"source_start_seconds": 1.15, "source_end_seconds": 2.85},
    )
    assert edited.status_code == 200, edited.text
    assert edited.json()["segments"][0]["source_start_seconds"] == pytest.approx(1.15)

    third_id = next(s["id"] for s in edited.json()["segments"] if s["order"] == 2)
    reordered = client.put(
        f"/api/projects/{project_id}/reels/{reel_id}/segments/order",
        json={
            "items": [
                {"id": second_id, "order": 0},
                {"id": first_id, "order": 1},
                {"id": third_id, "order": 2},
            ]
        },
    )
    assert reordered.status_code == 200, reordered.text
    orders = {s["id"]: s["order"] for s in reordered.json()["segments"]}
    assert orders[second_id] == 0
    assert orders[first_id] == 1

    deleted = client.delete(
        f"/api/projects/{project_id}/reels/{reel_id}/segments/{third_id}"
    )
    assert deleted.status_code == 200, deleted.text
    remaining = deleted.json()["segments"]
    assert len(remaining) == 2
    assert sorted(s["order"] for s in remaining) == [0, 1]


def test_segment_out_of_bounds_rejected(
    client: TestClient, project_with_duration: str
) -> None:
    project_id = project_with_duration
    resp = client.post(
        f"/api/projects/{project_id}/reels",
        json={
            "title": "Fuera de rango",
            "segments": [
                {
                    "source_start_seconds": 850.0,
                    "source_end_seconds": 920.0,
                    "transition_type": "hard_cut",
                    "transition_duration_ms": 0,
                }
            ],
        },
    )
    assert resp.status_code == 400
    assert resp.json()["code"] == "segment_out_of_bounds"


def test_list_get_update_delete_reel(
    client: TestClient, project_with_duration: str
) -> None:
    project_id = project_with_duration
    created = client.post(
        f"/api/projects/{project_id}/reels",
        json={"title": "Uno", "hook": "Empieza aquí"},
    )
    assert created.status_code == 201
    reel_id = created.json()["id"]

    listed = client.get(f"/api/projects/{project_id}/reels")
    assert listed.status_code == 200
    assert listed.json()["total"] == 1

    got = client.get(f"/api/projects/{project_id}/reels/{reel_id}")
    assert got.status_code == 200
    assert got.json()["title"] == "Uno"

    patched = client.patch(
        f"/api/projects/{project_id}/reels/{reel_id}",
        json={"title": "Dos", "aspect_ratio": "1:1", "audio_offset_ms": 240},
    )
    assert patched.status_code == 200
    assert patched.json()["title"] == "Dos"
    assert patched.json()["aspect_ratio"] == "1:1"
    assert patched.json()["audio_offset_ms"] == 240

    invalid_offset = client.patch(
        f"/api/projects/{project_id}/reels/{reel_id}",
        json={"audio_offset_ms": 1001},
    )
    assert invalid_offset.status_code == 422

    deleted = client.delete(f"/api/projects/{project_id}/reels/{reel_id}")
    assert deleted.status_code == 204
    assert client.get(f"/api/projects/{project_id}/reels/{reel_id}").status_code == 404


def test_from_transcript_creates_segments(
    client: TestClient, project_with_duration: str
) -> None:
    project_id = project_with_duration
    import json

    transcript = {
        "language": "es",
        "segments": [
            {"start": 5.0, "end": 8.0, "text": "Uno"},
            {"start": 20.0, "end": 25.0, "text": "Dos"},
            {"start": 40.0, "end": 42.0, "text": "Tres"},
        ],
    }
    files = {
        "file": ("t.json", json.dumps(transcript).encode("utf-8"), "application/json")
    }
    up = client.post(f"/api/projects/{project_id}/transcript", files=files)
    assert up.status_code == 201, up.text
    segments = up.json()["segments"]
    ids = [segments[0]["id"], segments[2]["id"]]

    resp = client.post(
        f"/api/projects/{project_id}/reels/from-transcript",
        json={"title": "Desde texto", "transcript_segment_ids": ids},
    )
    assert resp.status_code == 201, resp.text
    body = resp.json()
    assert len(body["segments"]) == 2
    assert body["segments"][0]["source_start_seconds"] == pytest.approx(5.0)
    assert body["segments"][1]["source_start_seconds"] == pytest.approx(40.0)
    assert body["segments"][0]["transcript_text"] is None


def test_patch_fragment_caption_persists_and_drives_preview(
    client: TestClient, project_with_duration: str
) -> None:
    """Editing a fragment subtitle must persist and appear in subtitle-preview."""
    project_id = project_with_duration
    import json

    transcript = {
        "language": "es",
        "segments": [
            {
                "start": 0.0,
                "end": 10.0,
                "text": "uno dos tres cuatro",
                "words": [
                    {"start": 0.5, "end": 1.5, "text": "uno"},
                    {"start": 1.5, "end": 2.5, "text": "dos"},
                    {"start": 2.5, "end": 3.5, "text": "tres"},
                    {"start": 3.5, "end": 4.5, "text": "cuatro"},
                ],
            }
        ],
    }
    files = {
        "file": ("t.json", json.dumps(transcript).encode("utf-8"), "application/json")
    }
    up = client.post(f"/api/projects/{project_id}/transcript", files=files)
    assert up.status_code == 201, up.text

    created = client.post(
        f"/api/projects/{project_id}/reels",
        json={
            "title": "Caption persist",
            "segments": [
                {
                    "source_start_seconds": 0.0,
                    "source_end_seconds": 5.0,
                    "transition_type": "hard_cut",
                    "transition_duration_ms": 0,
                }
            ],
        },
    )
    assert created.status_code == 201, created.text
    reel = created.json()
    segment_id = reel["segments"][0]["id"]

    edited = client.patch(
        f"/api/projects/{project_id}/reels/{reel['id']}/segments/{segment_id}",
        json={"transcript_text": "uno dos editado"},
    )
    assert edited.status_code == 200, edited.text
    assert edited.json()["segments"][0]["transcript_text"] == "uno dos editado"

    # Timing nudge must NOT wipe the saved subtitle (regression).
    nudged = client.patch(
        f"/api/projects/{project_id}/reels/{reel['id']}/segments/{segment_id}",
        json={"source_end_seconds": 4.8},
    )
    assert nudged.status_code == 200, nudged.text
    assert nudged.json()["segments"][0]["transcript_text"] == "uno dos editado"

    fetched = client.get(f"/api/projects/{project_id}/reels/{reel['id']}")
    assert fetched.status_code == 200, fetched.text
    assert fetched.json()["segments"][0]["transcript_text"] == "uno dos editado"

    preview = client.get(
        f"/api/projects/{project_id}/reels/{reel['id']}/subtitle-preview"
    )
    assert preview.status_code == 200, preview.text
    joined = " ".join(cue["text"] for cue in preview.json()["cues"]).lower()
    assert "editado" in joined
    assert "tres" not in joined
    assert "cuatro" not in joined


def test_reorder_incomplete_rejected(
    client: TestClient, project_with_duration: str
) -> None:
    project_id = project_with_duration
    created = client.post(
        f"/api/projects/{project_id}/reels",
        json={
            "title": "X",
            "segments": [
                {
                    "source_start_seconds": 1.0,
                    "source_end_seconds": 2.0,
                    "transition_type": "hard_cut",
                    "transition_duration_ms": 0,
                },
                {
                    "source_start_seconds": 3.0,
                    "source_end_seconds": 4.0,
                    "transition_type": "hard_cut",
                    "transition_duration_ms": 0,
                },
            ],
        },
    )
    reel = created.json()
    resp = client.put(
        f"/api/projects/{project_id}/reels/{reel['id']}/segments/order",
        json={"items": [{"id": reel["segments"][0]["id"], "order": 0}]},
    )
    assert resp.status_code == 400
    assert resp.json()["code"] == "incomplete_reorder"


def test_unknown_reel_returns_404(client: TestClient, project_with_duration: str) -> None:
    project_id = project_with_duration
    resp = client.get(f"/api/projects/{project_id}/reels/{uuid4()}")
    assert resp.status_code == 404
