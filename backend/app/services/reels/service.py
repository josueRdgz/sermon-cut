"""Business logic for Reels and non-consecutive ReelSegments."""

from __future__ import annotations

from datetime import UTC, datetime
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.core.exceptions import NotFoundError, ValidationAppError
from app.models.project import Project, ProjectStatus
from app.models.reel import Reel, ReelSegment, TransitionType
from app.models.transcript import TranscriptSegment
from app.schemas.reel import (
    ReelCreate,
    ReelFromTranscriptRequest,
    ReelResponse,
    ReelSegmentCreate,
    ReelSegmentReorderRequest,
    ReelSegmentResponse,
    ReelSegmentUpdate,
    ReelUpdate,
)
from app.services import projects as projects_service
from app.services.reels.validate import (
    SegmentTiming,
    content_duration_seconds,
    total_duration_seconds,
    validate_order_sequence,
    validate_segment_timing,
    validate_transition_duration,
)


def _touch(reel: Reel) -> None:
    reel.updated_at = datetime.now(UTC)


def _timing_view(segments: list[ReelSegment]) -> list[SegmentTiming]:
    return [
        SegmentTiming(
            source_start_seconds=s.source_start_seconds,
            source_end_seconds=s.source_end_seconds,
            transition_type=s.transition_type,
            transition_duration_ms=s.transition_duration_ms,
        )
        for s in sorted(segments, key=lambda s: s.order)
    ]


def _segment_response(segment: ReelSegment) -> ReelSegmentResponse:
    return ReelSegmentResponse(
        id=segment.id,
        reel_id=segment.reel_id,
        order=segment.order,
        source_start_seconds=segment.source_start_seconds,
        source_end_seconds=segment.source_end_seconds,
        transcript_text=segment.transcript_text,
        transition_type=segment.transition_type,
        transition_duration_ms=segment.transition_duration_ms,
        duration_seconds=segment.source_end_seconds - segment.source_start_seconds,
    )


def to_response(reel: Reel) -> ReelResponse:
    ordered = sorted(reel.segments, key=lambda s: s.order)
    timings = _timing_view(ordered)
    return ReelResponse(
        id=reel.id,
        project_id=reel.project_id,
        title=reel.title,
        hook=reel.hook,
        description=reel.description,
        editorial_score=reel.editorial_score,
        subtitle_style=reel.subtitle_style,
        subtitle_enabled=reel.subtitle_enabled,
        subtitle_granularity=reel.subtitle_granularity,
        subtitle_font_size=reel.subtitle_font_size,
        subtitle_position=reel.subtitle_position,
        subtitle_uppercase=reel.subtitle_uppercase,
        subtitle_max_words=reel.subtitle_max_words,
        subtitle_opacity=reel.subtitle_opacity,
        subtitle_margin_bottom=reel.subtitle_margin_bottom,
        subtitle_bible_reference=reel.subtitle_bible_reference,
        aspect_ratio=reel.aspect_ratio,
        status=reel.status,
        created_at=reel.created_at,
        updated_at=reel.updated_at,
        segments=[_segment_response(s) for s in ordered],
        content_duration_seconds=content_duration_seconds(timings),
        total_duration_seconds=total_duration_seconds(timings),
    )


def _load_reel_query():
    return select(Reel).options(selectinload(Reel.segments))


def get_reel(db: Session, reel_id: UUID) -> Reel:
    reel = db.scalars(_load_reel_query().where(Reel.id == reel_id)).first()
    if reel is None:
        raise NotFoundError("Reel not found.", code="reel_not_found")
    return reel


def get_reel_for_project(db: Session, project_id: UUID, reel_id: UUID) -> Reel:
    projects_service.get_project(db, project_id)
    reel = db.scalars(
        _load_reel_query().where(Reel.id == reel_id, Reel.project_id == project_id)
    ).first()
    if reel is None:
        raise NotFoundError("Reel not found.", code="reel_not_found")
    return reel


def list_reels(db: Session, project_id: UUID) -> list[Reel]:
    projects_service.get_project(db, project_id)
    return list(
        db.scalars(
            _load_reel_query()
            .where(Reel.project_id == project_id)
            .order_by(Reel.updated_at.desc())
        ).all()
    )


def _video_duration(project: Project) -> float | None:
    return project.duration_seconds


def _validate_payload_segment(
    *,
    start: float,
    end: float,
    transition_type: TransitionType,
    transition_duration_ms: int,
    video_duration: float | None,
    label: str,
) -> None:
    validate_segment_timing(
        start=start,
        end=end,
        video_duration=video_duration,
        label=label,
    )
    validate_transition_duration(
        transition_type=transition_type,
        duration_ms=transition_duration_ms,
    )


def _renumber(segments: list[ReelSegment]) -> None:
    for index, segment in enumerate(sorted(segments, key=lambda s: s.order)):
        segment.order = index


def create_reel(db: Session, project_id: UUID, payload: ReelCreate) -> Reel:
    project = projects_service.get_project(db, project_id)
    video_duration = _video_duration(project)

    reel = Reel(
        project_id=project_id,
        title=payload.title.strip(),
        hook=payload.hook.strip() if payload.hook else None,
        description=payload.description,
        editorial_score=payload.editorial_score,
        subtitle_style=payload.subtitle_style,
        subtitle_enabled=payload.subtitle_enabled,
        subtitle_granularity=payload.subtitle_granularity,
        subtitle_font_size=payload.subtitle_font_size,
        subtitle_position=payload.subtitle_position,
        subtitle_uppercase=payload.subtitle_uppercase,
        subtitle_max_words=payload.subtitle_max_words,
        subtitle_opacity=payload.subtitle_opacity,
        subtitle_margin_bottom=payload.subtitle_margin_bottom,
        subtitle_bible_reference=payload.subtitle_bible_reference,
        aspect_ratio=payload.aspect_ratio,
        status=payload.status,
    )

    for index, seg in enumerate(payload.segments):
        order = seg.order if seg.order is not None else index
        _validate_payload_segment(
            start=seg.source_start_seconds,
            end=seg.source_end_seconds,
            transition_type=seg.transition_type,
            transition_duration_ms=seg.transition_duration_ms,
            video_duration=video_duration,
            label=f"Segment {index + 1}",
        )
        reel.segments.append(
            ReelSegment(
                order=order,
                source_start_seconds=seg.source_start_seconds,
                source_end_seconds=seg.source_end_seconds,
                transcript_text=seg.transcript_text,
                transition_type=seg.transition_type,
                transition_duration_ms=seg.transition_duration_ms,
            )
        )

    validate_order_sequence([s.order for s in reel.segments])
    _renumber(list(reel.segments))

    if project.status in {ProjectStatus.created, ProjectStatus.ready}:
        project.status = ProjectStatus.editing

    db.add(reel)
    db.commit()
    return get_reel(db, reel.id)


def update_reel(db: Session, project_id: UUID, reel_id: UUID, payload: ReelUpdate) -> Reel:
    reel = get_reel_for_project(db, project_id, reel_id)
    data = payload.model_dump(exclude_unset=True)
    if not data:
        raise ValidationAppError("No fields to update.", code="empty_update")

    for key, value in data.items():
        if key in {"title", "hook"} and isinstance(value, str):
            value = value.strip() or None if key == "hook" else value.strip()
        setattr(reel, key, value)

    _touch(reel)
    db.commit()
    return get_reel(db, reel_id)


def delete_reel(db: Session, project_id: UUID, reel_id: UUID) -> None:
    reel = get_reel_for_project(db, project_id, reel_id)
    db.delete(reel)
    db.commit()


def add_segment(
    db: Session,
    project_id: UUID,
    reel_id: UUID,
    payload: ReelSegmentCreate,
) -> Reel:
    reel = get_reel_for_project(db, project_id, reel_id)
    project = projects_service.get_project(db, project_id)

    _validate_payload_segment(
        start=payload.source_start_seconds,
        end=payload.source_end_seconds,
        transition_type=payload.transition_type,
        transition_duration_ms=payload.transition_duration_ms,
        video_duration=_video_duration(project),
        label="Segment",
    )

    order = payload.order
    if order is None:
        order = len(reel.segments)
    else:
        # Shift existing segments at/after this order.
        for segment in reel.segments:
            if segment.order >= order:
                segment.order += 1

    reel.segments.append(
        ReelSegment(
            order=order,
            source_start_seconds=payload.source_start_seconds,
            source_end_seconds=payload.source_end_seconds,
            transcript_text=payload.transcript_text,
            transition_type=payload.transition_type,
            transition_duration_ms=payload.transition_duration_ms,
        )
    )
    _renumber(list(reel.segments))
    _touch(reel)
    db.commit()
    return get_reel(db, reel_id)


def update_segment(
    db: Session,
    project_id: UUID,
    reel_id: UUID,
    segment_id: UUID,
    payload: ReelSegmentUpdate,
) -> Reel:
    reel = get_reel_for_project(db, project_id, reel_id)
    project = projects_service.get_project(db, project_id)
    segment = next((s for s in reel.segments if s.id == segment_id), None)
    if segment is None:
        raise NotFoundError("Reel segment not found.", code="reel_segment_not_found")

    data = payload.model_dump(exclude_unset=True)
    if not data:
        raise ValidationAppError("No fields to update.", code="empty_update")

    start = data.get("source_start_seconds", segment.source_start_seconds)
    end = data.get("source_end_seconds", segment.source_end_seconds)
    transition_type = data.get("transition_type", segment.transition_type)
    transition_ms = data.get("transition_duration_ms", segment.transition_duration_ms)

    validate_segment_timing(
        start=start,
        end=end,
        video_duration=_video_duration(project),
        label="Segment",
    )
    validate_transition_duration(
        transition_type=transition_type,
        duration_ms=transition_ms,
    )

    for key, value in data.items():
        setattr(segment, key, value)

    _touch(reel)
    db.commit()
    return get_reel(db, reel_id)


def delete_segment(
    db: Session,
    project_id: UUID,
    reel_id: UUID,
    segment_id: UUID,
) -> Reel:
    reel = get_reel_for_project(db, project_id, reel_id)
    segment = next((s for s in reel.segments if s.id == segment_id), None)
    if segment is None:
        raise NotFoundError("Reel segment not found.", code="reel_segment_not_found")
    reel.segments.remove(segment)
    _renumber(list(reel.segments))
    _touch(reel)
    db.commit()
    return get_reel(db, reel_id)


def reorder_segments(
    db: Session,
    project_id: UUID,
    reel_id: UUID,
    payload: ReelSegmentReorderRequest,
) -> Reel:
    reel = get_reel_for_project(db, project_id, reel_id)
    by_id = {s.id: s for s in reel.segments}

    if len(payload.items) != len(by_id):
        raise ValidationAppError(
            "Reorder payload must include every segment exactly once.",
            code="incomplete_reorder",
        )

    seen: set[UUID] = set()
    for item in payload.items:
        if item.id in seen:
            raise ValidationAppError(
                "Duplicate segment id in reorder payload.",
                code="duplicate_reorder_id",
            )
        seen.add(item.id)
        if item.id not in by_id:
            raise NotFoundError("Reel segment not found.", code="reel_segment_not_found")

    validate_order_sequence([item.order for item in payload.items])

    for item in payload.items:
        by_id[item.id].order = item.order

    _touch(reel)
    db.commit()
    return get_reel(db, reel_id)


def create_or_append_from_transcript(
    db: Session,
    project_id: UUID,
    payload: ReelFromTranscriptRequest,
) -> Reel:
    """Build ReelSegments from transcript segment timings (non-contiguous OK)."""
    projects_service.get_project(db, project_id)

    transcript_segments: list[TranscriptSegment] = []
    for seg_id in payload.transcript_segment_ids:
        segment = db.get(TranscriptSegment, seg_id)
        if segment is None:
            raise NotFoundError(
                f"Transcript segment {seg_id} not found.",
                code="segment_not_found",
            )
        if segment.start_seconds is None or segment.end_seconds is None:
            raise ValidationAppError(
                "Transcript segment has no timing; cannot add to a Reel.",
                code="segment_unsynced",
            )
        transcript_segments.append(segment)

    # Preserve the caller's selection order (may intentionally skip source time).
    built: list[ReelSegmentCreate] = []
    for ts in transcript_segments:
        assert ts.start_seconds is not None and ts.end_seconds is not None
        built.append(
            ReelSegmentCreate(
                source_start_seconds=ts.start_seconds,
                source_end_seconds=ts.end_seconds,
                transcript_text=ts.text,
                transition_type=payload.transition_type,
                transition_duration_ms=payload.transition_duration_ms,
            )
        )

    if payload.reel_id is not None:
        reel = get_reel_for_project(db, project_id, payload.reel_id)
        for seg in built:
            add_segment(db, project_id, reel.id, seg)
        return get_reel(db, reel.id)

    return create_reel(
        db,
        project_id,
        ReelCreate(
            title=payload.title,
            aspect_ratio=payload.aspect_ratio,
            segments=built,
        ),
    )
