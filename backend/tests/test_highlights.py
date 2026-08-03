"""Video Highlights detection, validation, persistence and subtitle tests."""

from __future__ import annotations

import json
import shutil
import subprocess
from pathlib import Path
from uuid import uuid4

import pytest
from app.core.exceptions import ValidationAppError
from app.models.project import Project
from app.models.transcript import Transcript, TranscriptSegment, TranscriptSource, TranscriptStatus
from app.services.ai.schemas import TranscriptSegmentInput
from app.services.highlights import service as highlight_service
from app.services.highlights.ai import (
    AIHighlightSegment,
    AITitles,
    HighlightAIResponse,
    validate_highlight_response,
)
from app.services.highlights.detection import detect_sermon_range
from app.services.subtitles.srt import render_srt_for_reel


def _transcript(rows: list[tuple[float, float, str]]) -> Transcript:
    transcript = Transcript(
        project_id=uuid4(),
        source=TranscriptSource.whisper,
        status=TranscriptStatus.ready,
        full_text="\n".join(item[2] for item in rows),
        original_full_text="\n".join(item[2] for item in rows),
        has_word_timestamps=False,
    )
    transcript.segments = [
        TranscriptSegment(
            order=index,
            start_seconds=start,
            end_seconds=end,
            text=text,
            original_text=text,
        )
        for index, (start, end, text) in enumerate(rows)
    ]
    return transcript


def _ai_response() -> HighlightAIResponse:
    return HighlightAIResponse(
        title_theme="La gracia que transforma",
        biblical_references=["Efesios 2:8-10"],
        highlights=[
            AIHighlightSegment(
                start=10,
                end=45,
                transcript="La gracia de Dios nos salva y transforma nuestra vida completa.",
                reason="Presenta la idea central",
                score=0.95,
                category="hook",
            ),
            AIHighlightSegment(
                start=50,
                end=90,
                transcript="Somos salvos para buenas obras preparadas por Dios.",
                reason="Desarrollo bíblico",
                score=0.91,
                category="biblical",
            ),
            AIHighlightSegment(
                start=100,
                end=135,
                transcript="Vivamos entonces con esperanza, gratitud y obediencia.",
                reason="Conclusión y aplicación",
                score=0.93,
                category="conclusion",
            ),
        ],
        suggested_titles=AITitles(
            recommended="La gracia que transforma tu vida",
            direct="Salvos por gracia | Efesios 2",
            emotional="Cuando la gracia cambia tu historia",
            biblical="Salvos para buenas obras | Efesios 2:8-10",
            search_focused="Qué significa ser salvo por gracia según Efesios 2",
        ),
        thumbnail_text="GRACIA QUE TRANSFORMA",
        description="Un resumen fiel sobre la gracia y la obediencia cristiana.",
        hashtags=["#Predicación", "#Gracia", "#Efesios"],
        keywords=["gracia de Dios", "Efesios 2", "predicación cristiana"],
    )


def test_sermon_only_source_uses_full_spoken_range() -> None:
    transcript = _transcript(
        [
            (2, 40, "Abramos la palabra y estudiemos la gracia de Dios."),
            (42, 90, "Cristo es el centro de nuestra esperanza y salvación."),
            (92, 148, "Vivamos en obediencia como respuesta a su gracia."),
        ]
    )
    result = detect_sermon_range(transcript, 150)
    assert result.start == pytest.approx(1.5)
    assert result.end == pytest.approx(148.5)
    assert result.confidence >= 0.8
    assert result.requires_manual_range is False


def test_full_service_selects_sustained_middle_speech_cluster() -> None:
    transcript = _transcript(
        [
            (10, 20, "Bienvenidos al servicio y estos son los anuncios."),
            (180, 205, "Cantamos juntos una alabanza."),
            (600, 690, "Abramos la palabra para el mensaje de hoy."),
            (692, 980, "La gracia de Dios se revela plenamente en Cristo."),
            (982, 1240, "Esta verdad transforma nuestra vida y nuestra obediencia."),
            (1500, 1515, "Información de la próxima reunión."),
        ]
    )
    result = detect_sermon_range(transcript, 1600)
    assert 590 <= result.start <= 610
    assert 1230 <= result.end <= 1250
    assert result.method == "transcript_gaps_and_continuity"


def test_absence_of_expository_block_requires_manual_confirmation() -> None:
    transcript = _transcript(
        [
            (10, 40, "Bienvenidos, estos son los anuncios de la semana."),
            (42, 80, "La próxima actividad y reunión de jóvenes será el sábado."),
            (82, 120, "Ahora recibiremos la ofrenda y los diezmos."),
        ]
    )
    result = detect_sermon_range(transcript, 900)
    assert result.requires_manual_range is True
    assert result.confidence < 0.68


def test_validation_rejects_invented_transcript() -> None:
    response = _ai_response()
    response.highlights[0].transcript = "Una promesa financiera que nunca fue pronunciada."
    transcript = [
        TranscriptSegmentInput(order=0, start=0, end=150, text=" ".join(
            [
                "La gracia de Dios nos salva y transforma nuestra vida completa.",
                "Somos salvos para buenas obras preparadas por Dios.",
                "Vivamos entonces con esperanza, gratitud y obediencia.",
            ]
        ))
    ]
    with pytest.raises(ValidationAppError) as caught:
        validate_highlight_response(
            response,
            transcript=transcript,
            sermon_start=0,
            sermon_end=150,
            target_duration_seconds=120,
        )
    assert caught.value.code == "highlight_transcript_mismatch"


def test_apply_result_persists_review_metadata_and_history(db_session_factory) -> None:
    db = db_session_factory()
    project = Project(
        title="Gracia",
        church_name="Iglesia Central",
        youtube_channel="@central",
        duration_seconds=150,
        width=1920,
        height=1080,
    )
    db.add(project)
    db.commit()
    plan = highlight_service.get_or_create_plan(db, project.id)
    plan.sermon_start_seconds = 0
    plan.sermon_end_seconds = 150
    plan.sermon_confidence = 1
    db.commit()

    saved = highlight_service.apply_ai_result(
        db,
        plan=plan,
        response=_ai_response(),
        target_duration_seconds=120,
        editorial_style="doctrinal",
    )
    response = highlight_service.to_response(db, saved)

    assert response.reel_id is not None
    assert len(response.segments) == 3
    assert response.segments[0].category == "hook"
    assert response.metadata is not None
    assert response.metadata.suggested_titles is not None
    assert response.metadata.suggested_titles.recommended == "La gracia que transforma tu vida"
    assert response.regeneration_history[0]["editorial_style"] == "doctrinal"
    db.close()


def test_srt_uses_assembled_highlight_timeline(db_session_factory) -> None:
    db = db_session_factory()
    project = Project(
        title="Gracia",
        church_name="Iglesia",
        youtube_channel="@iglesia",
        duration_seconds=150,
    )
    db.add(project)
    db.commit()
    plan = highlight_service.get_or_create_plan(db, project.id)
    plan.sermon_start_seconds = 0
    plan.sermon_end_seconds = 150
    plan.sermon_confidence = 1
    db.commit()
    saved = highlight_service.apply_ai_result(
        db,
        plan=plan,
        response=_ai_response(),
        target_duration_seconds=120,
        editorial_style="balanced",
    )
    reel = db.get(highlight_service.Reel, saved.reel_id)
    body = render_srt_for_reel(reel, None)
    assert "00:00:00,000" in body
    assert "La gracia de Dios" in body
    assert "-->" in body
    db.close()


def test_highlight_detection_and_manual_range_api(client, db_session_factory) -> None:
    db = db_session_factory()
    project = Project(
        title="Transmisión completa",
        church_name="Iglesia",
        youtube_channel="@iglesia",
        duration_seconds=900,
        width=1280,
        height=720,
    )
    db.add(project)
    db.flush()
    transcript = _transcript(
        [
            (10, 25, "Bienvenidos y estos son los anuncios."),
            (300, 360, "Abramos la palabra para estudiar la gracia de Dios."),
            (362, 700, "Cristo nos salva por gracia y nos llama a buenas obras."),
        ]
    )
    transcript.project_id = project.id
    db.add(transcript)
    db.commit()
    project_id = project.id
    db.close()

    detected = client.post(f"/api/projects/{project_id}/highlights/detect")
    assert detected.status_code == 200, detected.text
    assert detected.json()["sermon_start"] is not None

    confirmed = client.patch(
        f"/api/projects/{project_id}/highlights/sermon-range",
        json={"start": 295.5, "end": 705.25},
    )
    assert confirmed.status_code == 200
    body = confirmed.json()
    assert body["sermon_start"] == pytest.approx(295.5)
    assert body["sermon_confidence"] == 1
    assert body["requires_manual_range"] is False


@pytest.mark.skipif(shutil.which("ffmpeg") is None, reason="FFmpeg is not installed")
def test_real_horizontal_render_preserves_source_frame_and_special_paths(
    tmp_path: Path,
) -> None:
    from app.services.render.args import RenderSegmentSpec, build_render_command
    from app.services.render.runner import run_ffmpeg

    ffmpeg = shutil.which("ffmpeg")
    ffprobe = shutil.which("ffprobe")
    assert ffmpeg is not None and ffprobe is not None
    source = tmp_path / "fuente sermón ñ con espacios.mp4"
    output = tmp_path / "resumen final á.mp4"
    subprocess.run(
        [
            ffmpeg,
            "-hide_banner",
            "-loglevel",
            "error",
            "-y",
            "-f",
            "lavfi",
            "-i",
            "testsrc=size=640x360:rate=24:duration=4",
            "-f",
            "lavfi",
            "-i",
            "sine=frequency=440:sample_rate=48000:duration=4",
            "-c:v",
            "libx264",
            "-pix_fmt",
            "yuv420p",
            "-c:a",
            "aac",
            str(source),
        ],
        check=True,
    )
    plan = build_render_command(
        ffmpeg=ffmpeg,
        source=source,
        segments=[
            RenderSegmentSpec(0.2, 1.6, "hard_cut", 0),
            RenderSegmentSpec(2.0, 3.6, "short_crossfade", 180),
        ],
        aspect_ratio="16:9",
        layout="center_crop",
        output_path=output,
        has_audio=True,
        fps=24,
        canvas_width=640,
        canvas_height=360,
    )
    run_ffmpeg(plan.args, log_path=tmp_path / "registro ffmpeg.log")
    probe = subprocess.run(
        [
            ffprobe,
            "-v",
            "error",
            "-select_streams",
            "v:0",
            "-show_entries",
            "stream=width,height",
            "-of",
            "json",
            str(output),
        ],
        capture_output=True,
        text=True,
        check=True,
    )
    stream = json.loads(probe.stdout)["streams"][0]
    assert stream == {"width": 640, "height": 360}
    assert output.is_file()
