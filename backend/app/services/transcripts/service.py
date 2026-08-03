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
            original_text=segment.original_text or segment.text,
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
        original_full_text=transcript.original_full_text or transcript.full_text,
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
        original_full_text=_full_text(parsed),
        has_word_timestamps=parsed.has_word_timestamps,
    )
    for order, parsed_segment in enumerate(parsed.segments):
        segment = TranscriptSegment(
            order=order,
            start_seconds=parsed_segment.start,
            end_seconds=parsed_segment.end,
            text=parsed_segment.text,
            original_text=parsed_segment.text,
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


def _sync_edited_words(segment: TranscriptSegment, text: str) -> None:
    """Keep word-level captions consistent after a user corrects segment text."""
    existing = sorted(segment.words, key=lambda word: word.order)
    if not existing:
        return

    tokens = text.split()
    if len(tokens) == len(existing):
        for token, word in zip(tokens, existing, strict=True):
            if word.text != token:
                word.text = token
                # Confidence belongs to the recognizer's original guess.
                word.confidence = None
        return

    start = segment.start_seconds
    end = segment.end_seconds
    if start is None or end is None or end <= start:
        segment.words.clear()
        return

    # When words were added or removed, distribute the corrected tokens across
    # the original segment window. Character weighting gives longer words a
    # little more screen time while preserving the segment boundaries.
    weights = [max(1, len(token)) for token in tokens]
    total_weight = sum(weights)
    duration = end - start
    rebuilt: list[TranscriptWord] = []
    elapsed_weight = 0
    for order, (token, weight) in enumerate(zip(tokens, weights, strict=True)):
        word_start = start + duration * elapsed_weight / total_weight
        elapsed_weight += weight
        word_end = (
            end
            if order == len(tokens) - 1
            else start + duration * elapsed_weight / total_weight
        )
        rebuilt.append(
            TranscriptWord(
                order=order,
                start_seconds=word_start,
                end_seconds=word_end,
                text=token,
                confidence=None,
            )
        )
    segment.words = rebuilt


def _remap_word_timings(
    segment: TranscriptSegment,
    *,
    old_start: float,
    old_end: float,
    new_start: float,
    new_end: float,
) -> None:
    """Map existing word timestamps into a new segment window proportionally."""
    if not segment.words:
        return
    old_duration = old_end - old_start
    new_duration = new_end - new_start
    if old_duration <= 0 or new_duration <= 0:
        return

    for word in sorted(segment.words, key=lambda item: item.order):
        if word.start_seconds is not None:
            ratio = (word.start_seconds - old_start) / old_duration
            word.start_seconds = new_start + max(0.0, min(1.0, ratio)) * new_duration
        if word.end_seconds is not None:
            ratio = (word.end_seconds - old_start) / old_duration
            word.end_seconds = new_start + max(0.0, min(1.0, ratio)) * new_duration
        if (
            word.start_seconds is not None
            and word.end_seconds is not None
            and word.end_seconds <= word.start_seconds
        ):
            word.end_seconds = min(new_end, word.start_seconds + 1e-3)
        if word.start_seconds is not None:
            word.start_seconds = min(max(word.start_seconds, new_start), new_end)
        if word.end_seconds is not None:
            word.end_seconds = min(max(word.end_seconds, new_start), new_end)


def update_segment(
    db: Session,
    segment_id: UUID,
    payload: TranscriptSegmentUpdate,
) -> Transcript:
    """Edit a segment's text and/or timing, then return the parent transcript.

    Timing overlaps with immediate neighbors adjust the shared boundary in the
    same DB transaction when safe; otherwise a Spanish validation error is raised.
    """
    segment = get_segment(db, segment_id)
    transcript = get_transcript_for_project(db, segment.transcript.project_id)

    data = payload.model_dump(exclude_unset=True)
    if not data:
        raise ValidationAppError("No hay campos para actualizar.", code="empty_update")

    new_text = data.get("text", segment.text)
    new_start = data.get("start_seconds", segment.start_seconds)
    new_end = data.get("end_seconds", segment.end_seconds)
    old_start = segment.start_seconds
    old_end = segment.end_seconds

    siblings = sorted(transcript.segments, key=lambda s: s.order)
    index = next(i for i, item in enumerate(siblings) if item.id == segment.id)
    previous = siblings[index - 1] if index > 0 else None
    following = siblings[index + 1] if index + 1 < len(siblings) else None

    from app.services.transcripts.types import ParsedSegment

    project = projects_service.get_project(db, transcript.project_id)
    max_duration = project.duration_seconds

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
        max_duration_seconds=max_duration,
        allow_neighbor_adjust=True,
    )

    cleaned_text = new_text.strip() if isinstance(new_text, str) else segment.text
    if not cleaned_text:
        raise ValidationAppError(
            "El texto del segmento no puede estar vacío.",
            code="empty_segment_text",
        )

    # Transactional neighbor boundary adjustment (shared limit).
    if (
        previous is not None
        and new_start is not None
        and previous.end_seconds is not None
        and previous.start_seconds is not None
        and new_start < previous.end_seconds
    ):
        prev_old_start = previous.start_seconds
        prev_old_end = previous.end_seconds
        previous.end_seconds = new_start
        if previous.words:
            _remap_word_timings(
                previous,
                old_start=prev_old_start,
                old_end=prev_old_end,
                new_start=prev_old_start,
                new_end=new_start,
            )

    if (
        following is not None
        and new_end is not None
        and following.start_seconds is not None
        and following.end_seconds is not None
        and new_end > following.start_seconds
    ):
        next_old_start = following.start_seconds
        next_old_end = following.end_seconds
        following.start_seconds = new_end
        if following.words:
            _remap_word_timings(
                following,
                old_start=next_old_start,
                old_end=next_old_end,
                new_start=new_end,
                new_end=next_old_end,
            )

    timing_changed = new_start != old_start or new_end != old_end
    segment.start_seconds = new_start
    segment.end_seconds = new_end
    if cleaned_text != segment.text:
        segment.text = cleaned_text
        _sync_edited_words(segment, cleaned_text)
    elif (
        timing_changed
        and old_start is not None
        and old_end is not None
        and new_start is not None
        and new_end is not None
        and segment.words
    ):
        _remap_word_timings(
            segment,
            old_start=old_start,
            old_end=old_end,
            new_start=new_start,
            new_end=new_end,
        )

    transcript.full_text = "\n".join(s.text for s in siblings)
    transcript.has_word_timestamps = any(
        word.start_seconds is not None and word.end_seconds is not None
        for sibling in siblings
        for word in sibling.words
    )
    if all(s.start_seconds is not None and s.end_seconds is not None for s in siblings):
        transcript.status = TranscriptStatus.ready
    _touch(transcript)
    db.commit()
    return get_transcript_for_project(db, transcript.project_id)
