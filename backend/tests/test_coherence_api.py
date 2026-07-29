"""API tests for Reel join-coherence validation."""

from __future__ import annotations

from uuid import UUID

from app.models.project import Project
from app.models.transcript import (
    Transcript,
    TranscriptSegment,
    TranscriptSource,
    TranscriptStatus,
)
from fastapi.testclient import TestClient
from sqlalchemy.orm import sessionmaker


def _project(client: TestClient, session_factory: sessionmaker) -> str:
    resp = client.post(
        "/api/projects",
        json={
            "title": "Coherencia",
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


def test_validate_coherent_reel(client: TestClient, db_session_factory: sessionmaker) -> None:
    project_id = _project(client, db_session_factory)
    created = client.post(
        f"/api/projects/{project_id}/reels",
        json={
            "title": "Coherente",
            "segments": [
                {
                    "source_start_seconds": 10.0,
                    "source_end_seconds": 18.0,
                    "transcript_text": "La gracia de Dios es suficiente para todo pecador.",
                },
                {
                    "source_start_seconds": 18.2,
                    "source_end_seconds": 26.0,
                    "transcript_text": (
                        "Cristo es el centro de la predicación y de nuestra esperanza."
                    ),
                },
            ],
        },
    )
    assert created.status_code == 201, created.text
    reel_id = created.json()["id"]

    report = client.post(
        f"/api/projects/{project_id}/reels/{reel_id}/validate",
        json={"include_ai_review": False, "include_media_probes": False},
    )
    assert report.status_code == 200, report.text
    body = report.json()
    assert body["severity"] == "valid"
    assert body["can_render"] is True
    assert body["issues"] == []


def test_validate_incoherent_reel_and_dismiss(
    client: TestClient, db_session_factory: sessionmaker
) -> None:
    project_id = _project(client, db_session_factory)
    created = client.post(
        f"/api/projects/{project_id}/reels",
        json={
            "title": "Incoherente",
            "segments": [
                {
                    "source_start_seconds": 10.0,
                    "source_end_seconds": 16.0,
                    "transcript_text": "Dios ama al mundo y envió a su Hijo.",
                },
                {
                    "source_start_seconds": 80.0,
                    "source_end_seconds": 90.0,
                    "transcript_text": (
                        "Por eso debemos arrepentirnos y creer en el evangelio ahora."
                    ),
                },
            ],
        },
    )
    assert created.status_code == 201, created.text
    reel_id = created.json()["id"]

    report = client.post(
        f"/api/projects/{project_id}/reels/{reel_id}/validate",
        json={"include_ai_review": False, "include_media_probes": False},
    )
    assert report.status_code == 200, report.text
    body = report.json()
    assert body["severity"] in {"warning", "blocked"}
    assert body["can_render"] is False
    assert any(i["code"] == "DANGLING_CONNECTOR" for i in body["issues"])
    assert all("code" in i and "message" in i and "segment_id" in i for i in body["issues"])

    dangling = next(i for i in body["issues"] if i["code"] == "DANGLING_CONNECTOR")
    if dangling["severity"] == "warning":
        dismissed = client.post(
            f"/api/projects/{project_id}/reels/{reel_id}/validate/dismiss",
            json={"code": dangling["code"], "segment_id": dangling["segment_id"]},
        )
        assert dismissed.status_code == 200, dismissed.text
        assert any(i["dismissed"] for i in dismissed.json()["issues"])
    else:
        blocked = client.post(
            f"/api/projects/{project_id}/reels/{reel_id}/validate/dismiss",
            json={"code": dangling["code"], "segment_id": dangling["segment_id"]},
        )
        assert blocked.status_code == 400


def test_expand_context_widens_segment(
    client: TestClient, db_session_factory: sessionmaker
) -> None:
    project_id = _project(client, db_session_factory)
    created = client.post(
        f"/api/projects/{project_id}/reels",
        json={
            "title": "Expandir",
            "segments": [
                {
                    "source_start_seconds": 20.0,
                    "source_end_seconds": 30.0,
                    "transcript_text": "texto central",
                }
            ],
        },
    )
    reel_id = created.json()["id"]
    expanded = client.post(
        f"/api/projects/{project_id}/reels/{reel_id}/validate/expand-context",
        json={"segment_id": 1, "before_seconds": 2.0, "after_seconds": 1.5},
    )
    assert expanded.status_code == 200, expanded.text
    segment = expanded.json()["segments"][0]
    assert segment["source_start_seconds"] == 18.0
    assert segment["source_end_seconds"] == 31.5


def test_auto_fix_completes_cut_sentence_and_revalidates(
    client: TestClient, db_session_factory: sessionmaker
) -> None:
    project_id = _project(client, db_session_factory)
    with db_session_factory() as db:
        transcript = Transcript(
            project_id=UUID(project_id),
            source=TranscriptSource.manual,
            status=TranscriptStatus.ready,
            full_text="La salvación viene por la fe. En Cristo tenemos esperanza.",
            has_word_timestamps=False,
        )
        transcript.segments.extend(
            [
                TranscriptSegment(
                    order=0,
                    start_seconds=10.0,
                    end_seconds=15.0,
                    text="La salvación viene por",
                ),
                TranscriptSegment(
                    order=1,
                    start_seconds=15.0,
                    end_seconds=20.0,
                    text="la fe. En Cristo tenemos esperanza.",
                ),
            ]
        )
        db.add(transcript)
        db.commit()

    created = client.post(
        f"/api/projects/{project_id}/reels",
        json={
            "title": "Frase cortada",
            "segments": [
                {
                    "source_start_seconds": 10.0,
                    "source_end_seconds": 15.0,
                    "transcript_text": "La salvación viene por",
                }
            ],
        },
    )
    assert created.status_code == 201, created.text
    reel_id = created.json()["id"]

    fixed = client.post(
        f"/api/projects/{project_id}/reels/{reel_id}/validate/auto-fix",
        json={"include_media_probes": False},
    )
    assert fixed.status_code == 200, fixed.text
    body = fixed.json()
    assert body["reel"]["segments"][0]["source_end_seconds"] == 20.0
    assert body["report"]["severity"] == "valid"
    assert body["remaining_issues"] == 0
    assert any("final de la idea" in item for item in body["fixes"])
