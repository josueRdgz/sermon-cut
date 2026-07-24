"""Transcript import, edit, delete and export endpoints."""

from __future__ import annotations

from typing import Literal
from uuid import UUID

from fastapi import APIRouter, Depends, File, Form, UploadFile
from fastapi.responses import PlainTextResponse, Response
from sqlalchemy.orm import Session

from app.core.exceptions import ValidationAppError
from app.db.session import get_db
from app.schemas.transcript import TranscriptResponse, TranscriptSegmentUpdate
from app.services.transcripts import export as transcript_export
from app.services.transcripts import service as transcripts_service

router = APIRouter(tags=["transcripts"])

# Transcripts are text; keep a generous but finite ceiling.
_MAX_TRANSCRIPT_BYTES = 20 * 1024 * 1024


@router.post(
    "/projects/{project_id}/transcript",
    response_model=TranscriptResponse,
    status_code=201,
)
async def upload_transcript(
    project_id: UUID,
    file: UploadFile = File(...),
    language: str | None = Form(default=None),
    db: Session = Depends(get_db),
) -> TranscriptResponse:
    """Upload and normalize a transcript (SRT, VTT, JSON or TXT)."""
    if not file.filename:
        raise ValidationAppError("Missing upload filename.", code="missing_filename")

    raw = await file.read(_MAX_TRANSCRIPT_BYTES + 1)
    if len(raw) > _MAX_TRANSCRIPT_BYTES:
        raise ValidationAppError(
            f"Transcript exceeds {_MAX_TRANSCRIPT_BYTES} bytes.",
            code="file_too_large",
        )

    try:
        content = raw.decode("utf-8")
    except UnicodeDecodeError as exc:
        raise ValidationAppError(
            "Transcript must be UTF-8 text.",
            code="invalid_encoding",
        ) from exc

    transcript = transcripts_service.import_transcript(
        db,
        project_id,
        filename=file.filename,
        content=content,
        language=language.strip() if language else None,
    )
    return transcripts_service.to_response(transcript)


@router.get("/projects/{project_id}/transcript", response_model=TranscriptResponse)
def get_transcript(project_id: UUID, db: Session = Depends(get_db)) -> TranscriptResponse:
    """Return the project's normalized transcript with segments."""
    transcript = transcripts_service.get_transcript_for_project(db, project_id)
    return transcripts_service.to_response(transcript)


@router.delete("/projects/{project_id}/transcript", status_code=204)
def delete_transcript(project_id: UUID, db: Session = Depends(get_db)) -> None:
    """Delete the project's transcript and all of its segments/words."""
    transcripts_service.delete_transcript(db, project_id)


@router.patch(
    "/transcripts/segments/{segment_id}",
    response_model=TranscriptResponse,
)
def update_segment(
    segment_id: UUID,
    payload: TranscriptSegmentUpdate,
    db: Session = Depends(get_db),
) -> TranscriptResponse:
    """Edit a segment's text and/or timing."""
    transcript = transcripts_service.update_segment(db, segment_id, payload)
    return transcripts_service.to_response(transcript)


@router.get("/projects/{project_id}/transcript/export")
def export_transcript(
    project_id: UUID,
    format: Literal["srt", "vtt", "json"] = "json",
    db: Session = Depends(get_db),
) -> Response:
    """Export the transcript as SRT, WebVTT or internal JSON."""
    transcript = transcripts_service.get_transcript_for_project(db, project_id)

    if format == "json":
        body = transcript_export.export_json(transcript)
        return Response(
            content=body,
            media_type="application/json; charset=utf-8",
            headers={
                "Content-Disposition": f'attachment; filename="transcript-{project_id}.json"'
            },
        )
    if format == "srt":
        body = transcript_export.export_srt(transcript)
        return PlainTextResponse(
            content=body,
            media_type="application/x-subrip; charset=utf-8",
            headers={
                "Content-Disposition": f'attachment; filename="transcript-{project_id}.srt"'
            },
        )
    body = transcript_export.export_vtt(transcript)
    return PlainTextResponse(
        content=body,
        media_type="text/vtt; charset=utf-8",
        headers={
            "Content-Disposition": f'attachment; filename="transcript-{project_id}.vtt"'
        },
    )
