"""API tests for optional technical cut suggestions."""

from __future__ import annotations

from uuid import UUID

from app.models.project import Project
from fastapi.testclient import TestClient
from sqlalchemy.orm import sessionmaker


def _project(client: TestClient, session_factory: sessionmaker) -> str:
    resp = client.post(
        "/api/projects",
        json={
            "title": "Cortes técnicos",
            "church_name": "Iglesia",
            "youtube_channel": "canal",
        },
    )
    assert resp.status_code == 201, resp.text
    project_id = resp.json()["id"]
    with session_factory() as db:
        project = db.get(Project, UUID(project_id))
        assert project is not None
        project.duration_seconds = 600.0
        project.video_filename = "original.mp4"
        db.commit()
    return project_id


def test_generate_accept_reject_cut_suggestions(
    client: TestClient, db_session_factory: sessionmaker, monkeypatch
) -> None:
    project_id = _project(client, db_session_factory)

    def fake_runner(args: list[str]) -> str:
        return (
            "silence_start: 0.00\n"
            "silence_end: 1.50 | silence_duration: 1.50\n"
            "silence_start: 8.00\n"
            "silence_end: 10.20 | silence_duration: 2.20\n"
            "silence_start: 18.00\n"
            "silence_end: 20.00 | silence_duration: 2.00\n"
        )

    created = client.post(
        f"/api/projects/{project_id}/reels",
        json={
            "title": "Reel de prueba",
            "segments": [
                {
                    "source_start_seconds": 10.0,
                    "source_end_seconds": 30.0,
                    "transcript_text": (
                        "La gracia de Dios es suficiente. "
                        "Cristo es el centro de nuestra esperanza."
                    ),
                }
            ],
        },
    )
    assert created.status_code == 201, created.text
    reel_id = created.json()["id"]

    # Create a dummy video file so include_silence path runs.
    from app.services import storage

    video_path = storage.resolve_inside_project(UUID(project_id), "original.mp4")
    video_path.parent.mkdir(parents=True, exist_ok=True)
    video_path.write_bytes(b"fake")

    monkeypatch.setattr(
        "app.services.cut_suggestions.service.detect_silences",
        lambda **kwargs: __import__(
            "app.services.cut_suggestions.silence", fromlist=["SilenceInterval"]
        ).parse_silencedetect_output(
            fake_runner([]),
            window_start=kwargs["start"],
            window_duration=kwargs["end"] - kwargs["start"],
        ),
    )

    report = client.post(
        f"/api/projects/{project_id}/reels/{reel_id}/cut-suggestions",
        json={"intensity": "conservative", "include_silence": True, "include_fillers": True},
    )
    assert report.status_code == 200, report.text
    body = report.json()
    assert body["auto_applied"] is False
    assert body["intensity"] == "conservative"
    assert body["pending_count"] >= 1
    pending = [s for s in body["suggestions"] if s["status"] == "pending"]
    assert pending

    # Reject first suggestion — reel unchanged.
    rejected = client.post(
        f"/api/projects/{project_id}/reels/{reel_id}/cut-suggestions/{pending[0]['id']}/reject",
        json={},
    )
    assert rejected.status_code == 200, rejected.text
    assert rejected.json()["suggestion"]["status"] == "rejected"
    assert rejected.json()["reel"]["segments"][0]["source_start_seconds"] == 10.0

    # Regenerate and accept a leading trim if present.
    report2 = client.post(
        f"/api/projects/{project_id}/reels/{reel_id}/cut-suggestions",
        json={"intensity": "conservative"},
    )
    assert report2.status_code == 200, report2.text
    pending2 = [s for s in report2.json()["suggestions"] if s["status"] == "pending"]
    edge = next(
        (
            s
            for s in pending2
            if s["kind"] in {"trim_leading_silence", "trim_trailing_silence"}
            and not s["split"]
        ),
        pending2[0] if pending2 else None,
    )
    assert edge is not None
    accepted = client.post(
        f"/api/projects/{project_id}/reels/{reel_id}/cut-suggestions/{edge['id']}/accept",
        json={},
    )
    assert accepted.status_code == 200, accepted.text
    assert accepted.json()["suggestion"]["status"] == "accepted"
    assert accepted.json()["subtitles_stale"] is True
    # Reel timings must have changed only after accept.
    seg = accepted.json()["reel"]["segments"][0]
    assert (
        seg["source_start_seconds"] != 10.0
        or seg["source_end_seconds"] != 30.0
        or len(accepted.json()["reel"]["segments"]) > 1
    )


def test_default_request_uses_conservative(client: TestClient, db_session_factory: sessionmaker) -> None:
    project_id = _project(client, db_session_factory)
    created = client.post(
        f"/api/projects/{project_id}/reels",
        json={
            "title": "Default",
            "segments": [
                {
                    "source_start_seconds": 1.0,
                    "source_end_seconds": 5.0,
                    "transcript_text": "Amén.",
                }
            ],
        },
    )
    reel_id = created.json()["id"]
    report = client.post(
        f"/api/projects/{project_id}/reels/{reel_id}/cut-suggestions",
        json={},
    )
    assert report.status_code == 200, report.text
    assert report.json()["intensity"] == "conservative"
    assert report.json()["auto_applied"] is False
