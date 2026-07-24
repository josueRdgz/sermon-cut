"""Business logic for project transcripts."""

from __future__ import annotations

from datetime import UTC, datetime
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.core.exceptions import NotFoundError, ValidationAppError
from app.models.project import ProjectStatus
from app.models.transcript import (
    Transcript,
    TranscriptSegment,
    TranscriptSource,
    TranscriptStatus,
    TranscriptWord,
)
from app.schemas.transcript import (
    TranscriptResponse,
    TranscriptSegmentResponse,
    TranscriptSegmentUpdate,
    TranscriptWordResponse,
)
from app.services import projects as projects_service
from app.services.transcripts import parse_transcript_file
from app.services.transcripts.types import ParsedTranscript
from app.services.transcripts.validate import validate_segment_edit


def _touch(transcript: Transcript) -> None:
    transcript.updated_at = datetime.now(UTC)


def _full_text(parsed: ParsedTranscript) -> str:
    return "\n".join(segment.text for segment in parsed.segments)


def to_response(transcript: Transcript) -> TranscriptResponse:
    segments = [
        TranscriptSegmentResponse(
            id=segment.id,
            order=segment.order,
            start_seconds=segment.start_seconds,
            end_seconds=segment.end_seconds,
            text=segment.text,
            words=[
                TranscriptWordResponse(
                    id=word.id,
                    order=word.order,
                    start_seconds=word.start_seconds,
                    end_seconds=word.end_seconds,
                    text=word.text,
                    confidence=word.confidence,
                )
                for word in sorted(segment.words, key=lambda w: w.order)
            ],
        )
        for segment in sorted(transcript.segments, key=lambda s: s.order)
    ]
    return TranscriptResponse(
        id=transcript.id,
        project_id=transcript.project_id,
        source=transcript.source,
        language=transcript.language,
        status=transcript.status,
        full_text=transcript.full_text,
        has_word_timestamps=transcript.has_word_timestamps,
        created_at=transcript.created_at,
        updated_at=transcript.updated_at,
        segments=segments,
    )


def _load_transcript_query():
    return select(Transcript).options(
        selectinload(Transcript.segments).selectinload(TranscriptSegment.words)
    )


def get_transcript_for_project(db: Session, project_id: UUID) -> Transcript:
    projects_service.get_project(db, project_id)
    transcript = db.scalars(
        _load_transcript_query().where(Transcript.project_id == project_id)
    ).first()
    if transcript is None:
        raise NotFoundError("Transcript not found.", code="transcript_not_found")
    return transcript


def get_segment(db: Session, segment_id: UUID) -> TranscriptSegment:
    segment = db.scalars(
        select(TranscriptSegment)
        .where(TranscriptSegment.id == segment_id)
        .options(selectinload(TranscriptSegment.words), selectinload(TranscriptSegment.transcript))
    ).first()
    if segment is None:
        raise NotFoundError("Transcript segment not found.", code="segment_not_found")
    return segment


def _build_orm_from_parsed(
    *,
    project_id: UUID,
    source,
    parsed: ParsedTranscript,
) -> Transcript:
    status = TranscriptStatus.ready if parsed.has_timing else TranscriptStatus.unsynced
    transcript = Transcript(
        project_id=project_id,
        source=source,
        language=parsed.language,
        status=status,
        full_text=_full_text(parsed),
        has_word_timestamps=parsed.has_word_timestamps,
    )
    for order, parsed_segment in enumerate(parsed.segments):
        segment = TranscriptSegment(
            order=order,
            start_seconds=parsed_segment.start,
            end_seconds=parsed_segment.end,
            text=parsed_segment.text,
        )
        for word_order, parsed_word in enumerate(parsed_segment.words):
            segment.words.append(
                TranscriptWord(
                    order=word_order,
                    start_seconds=parsed_word.start,
                    end_seconds=parsed_word.end,
                    text=parsed_word.text,
                    confidence=parsed_word.confidence,
                )
            )
        transcript.segments.append(segment)
    return transcript


def replace_transcript_from_parsed(
    db: Session,
    project_id: UUID,
    *,
    source: TranscriptSource,
    parsed: ParsedTranscript,
    commit: bool = True,
) -> Transcript:
    """Persist a parsed transcript for a project, replacing any existing one.

    Shared by file import and by the local whisper engine.
    """
    project = projects_service.get_project(db, project_id)

    existing = db.scalars(select(Transcript).where(Transcript.project_id == project_id)).first()
    if existing is not None:
        db.delete(existing)
        db.flush()

    transcript = _build_orm_from_parsed(project_id=project_id, source=source, parsed=parsed)
    db.add(transcript)

    if project.status in {
        ProjectStatus.created,
        ProjectStatus.ready,
        ProjectStatus.importing,
        ProjectStatus.transcribing,
    }:
        project.status = ProjectStatus.ready

    if commit:
        db.commit()
    return transcript


def import_transcript(
    db: Session,
    project_id: UUID,
    *,
    filename: str | None,
    content: str,
    language: str | None = None,
) -> Transcript:
    """Parse, validate and persist a transcript for a project (replacing any existing one)."""
    projects_service.get_project(db, project_id)
    source, parsed = parse_transcript_file(filename, content)
    if language:
        parsed.language = language

    replace_transcript_from_parsed(db, project_id, source=source, parsed=parsed)
    return get_transcript_for_project(db, project_id)


def delete_transcript(db: Session, project_id: UUID) -> None:
    transcript = get_transcript_for_project(db, project_id)
    db.delete(transcript)
    db.commit()


def update_segment(
    db: Session,
    segment_id: UUID,
    payload: TranscriptSegmentUpdate,
) -> Transcript:
    """Edit a segment's text and/or timing, then return the parent transcript."""
    segment = get_segment(db, segment_id)
    transcript = get_transcript_for_project(db, segment.transcript.project_id)

    data = payload.model_dump(exclude_unset=True)
    if not data:
        raise ValidationAppError("No fields to update.", code="empty_update")

    new_text = data.get("text", segment.text)
    new_start = data.get("start_seconds", segment.start_seconds)
    new_end = data.get("end_seconds", segment.end_seconds)

    siblings = sorted(transcript.segments, key=lambda s: s.order)
    index = next(i for i, item in enumerate(siblings) if item.id == segment.id)
    previous = siblings[index - 1] if index > 0 else None
    following = siblings[index + 1] if index + 1 < len(siblings) else None

    from app.services.transcripts.types import ParsedSegment

    validate_segment_edit(
        start_seconds=new_start,
        end_seconds=new_end,
        previous=(
            ParsedSegment(
                text=previous.text,
                start=previous.start_seconds,
                end=previous.end_seconds,
            )
            if previous
            else None
        ),
        next_segment=(
            ParsedSegment(
                text=following.text,
                start=following.start_seconds,
                end=following.end_seconds,
            )
            if following
            else None
        ),
    )

    segment.text = new_text.strip() if isinstance(new_text, str) else segment.text
    segment.start_seconds = new_start
    segment.end_seconds = new_end

    transcript.full_text = "\n".join(s.text for s in siblings)
    if all(s.start_seconds is not None and s.end_seconds is not None for s in siblings):
        transcript.status = TranscriptStatus.ready
    _touch(transcript)
    db.commit()
    return get_transcript_for_project(db, transcript.project_id)
