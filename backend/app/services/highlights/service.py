"""Persistence and review operations for Video Highlights."""

from __future__ import annotations

import json
from datetime import UTC, datetime
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.core.exceptions import NotFoundError, ValidationAppError
from app.models.highlight import ContentMetadata, HighlightPlan
from app.models.project import Project
from app.models.reel import (
    AspectRatio,
    ContentKind,
    Reel,
    ReelSegment,
    SubtitleGranularity,
    SubtitlePosition,
    TransitionType,
)
from app.schemas.highlight import (
    ContentMetadataResponse,
    ContentMetadataUpdate,
    HighlightPlanResponse,
    HighlightReviewUpdate,
    HighlightSegmentResponse,
    SermonRangeUpdate,
    StrategicTitles,
)
from app.services.highlights.ai import HighlightAIResponse
from app.services.highlights.detection import SermonDetection, detect_sermon_range
from app.services.transcripts import service as transcripts_service


def _utc_now() -> datetime:
    return datetime.now(UTC)


def _json_list(value: str | None) -> list:
    try:
        parsed = json.loads(value or "[]")
    except json.JSONDecodeError:
        return []
    return parsed if isinstance(parsed, list) else []


def _json_dict(value: str | None) -> dict:
    try:
        parsed = json.loads(value or "{}")
    except json.JSONDecodeError:
        return {}
    return parsed if isinstance(parsed, dict) else {}


def get_or_create_plan(db: Session, project_id: UUID) -> HighlightPlan:
    project = db.get(Project, project_id)
    if project is None:
        raise NotFoundError("Proyecto no encontrado.", code="project_not_found")
    plan = db.scalars(
        select(HighlightPlan).where(HighlightPlan.project_id == project_id)
    ).first()
    if plan is None:
        plan = HighlightPlan(project_id=project_id)
        db.add(plan)
        db.commit()
        db.refresh(plan)
    return plan


def get_plan(db: Session, project_id: UUID) -> HighlightPlan:
    plan = db.scalars(
        select(HighlightPlan).where(HighlightPlan.project_id == project_id)
    ).first()
    if plan is None:
        raise NotFoundError(
            "Todavía no existe un plan de Video Highlights.",
            code="highlight_plan_not_found",
        )
    return plan


def detect(db: Session, project_id: UUID) -> HighlightPlan:
    project = db.get(Project, project_id)
    if project is None:
        raise NotFoundError("Proyecto no encontrado.", code="project_not_found")
    if not project.duration_seconds:
        raise ValidationAppError(
            "El proyecto debe tener un video analizado antes de detectar la predicación.",
            code="video_metadata_missing",
        )
    transcript = transcripts_service.get_transcript_for_project(db, project_id)
    result = detect_sermon_range(transcript, project.duration_seconds)
    plan = get_or_create_plan(db, project_id)
    _apply_detection(plan, result)
    db.commit()
    db.refresh(plan)
    return plan


def update_sermon_range(
    db: Session,
    project_id: UUID,
    payload: SermonRangeUpdate,
) -> HighlightPlan:
    project = db.get(Project, project_id)
    if project is None:
        raise NotFoundError("Proyecto no encontrado.", code="project_not_found")
    if project.duration_seconds is not None and payload.end > project.duration_seconds + 0.25:
        raise ValidationAppError(
            "El final de la predicación supera la duración del video.",
            code="sermon_range_out_of_bounds",
        )
    plan = get_or_create_plan(db, project_id)
    plan.sermon_start_seconds = payload.start
    plan.sermon_end_seconds = payload.end
    plan.sermon_confidence = 1.0
    plan.sermon_detection_method = "manual"
    plan.sermon_detection_notes = "Intervalo confirmado manualmente por el usuario."
    plan.updated_at = _utc_now()
    db.commit()
    db.refresh(plan)
    return plan


def apply_ai_result(
    db: Session,
    *,
    plan: HighlightPlan,
    response: HighlightAIResponse,
    target_duration_seconds: int,
    editorial_style: str,
) -> HighlightPlan:
    reel = db.get(Reel, plan.reel_id) if plan.reel_id else None
    if reel is None:
        reel = Reel(
            project_id=plan.project_id,
            title=response.suggested_titles.recommended,
            description=response.description,
            content_kind=ContentKind.highlight,
            aspect_ratio=AspectRatio.sixteen_nine,
            framing_mode="center_crop",
            subtitle_enabled=True,
            subtitle_granularity=SubtitleGranularity.phrase,
            subtitle_position=SubtitlePosition.bottom,
            subtitle_font_size=44,
            subtitle_max_words=10,
            subtitle_margin_bottom=72,
        )
        db.add(reel)
        db.flush()
        plan.reel_id = reel.id
    else:
        for segment in list(reel.segments):
            db.delete(segment)
        db.flush()
        reel.title = response.suggested_titles.recommended
        reel.description = response.description
        reel.content_kind = ContentKind.highlight
        reel.aspect_ratio = AspectRatio.sixteen_nine

    for order, item in enumerate(response.highlights):
        db.add(
            ReelSegment(
                reel_id=reel.id,
                order=order,
                source_start_seconds=item.start,
                source_end_seconds=item.end,
                transcript_text=item.transcript,
                transition_type=TransitionType.hard_cut,
                transition_duration_ms=0,
                selection_reason=item.reason,
                selection_score=item.score,
                narrative_category=item.category,
            )
        )

    metadata = db.scalars(
        select(ContentMetadata).where(ContentMetadata.reel_id == reel.id)
    ).first()
    if metadata is None:
        metadata = ContentMetadata(
            project_id=plan.project_id,
            reel_id=reel.id,
            content_kind=ContentKind.highlight.value,
        )
        db.add(metadata)
    metadata.suggested_titles_json = json.dumps(
        response.suggested_titles.model_dump(mode="json"), ensure_ascii=False
    )
    metadata.chosen_title = response.suggested_titles.recommended
    metadata.description = response.description
    metadata.thumbnail_text = response.thumbnail_text
    metadata.hashtags_json = json.dumps(response.hashtags, ensure_ascii=False)
    metadata.keywords_json = json.dumps(response.keywords, ensure_ascii=False)

    history = _json_list(plan.regeneration_history_json)
    history.append(
        {
            "at": _utc_now().isoformat(),
            "target_duration_seconds": target_duration_seconds,
            "editorial_style": editorial_style,
            "segment_count": len(response.highlights),
        }
    )
    plan.target_duration_seconds = target_duration_seconds
    plan.editorial_style = editorial_style
    plan.title_theme = response.title_theme
    plan.biblical_references_json = json.dumps(
        response.biblical_references, ensure_ascii=False
    )
    plan.regeneration_history_json = json.dumps(history[-30:], ensure_ascii=False)
    plan.updated_at = _utc_now()
    db.commit()
    db.refresh(plan)
    return plan


def update_review(
    db: Session,
    project_id: UUID,
    payload: HighlightReviewUpdate,
) -> HighlightPlan:
    plan = get_plan(db, project_id)
    if plan.reel_id is None:
        raise ValidationAppError(
            "Genere una selección antes de editar fragmentos.",
            code="highlight_selection_missing",
        )
    reel = db.scalars(
        select(Reel).where(Reel.id == plan.reel_id).options(selectinload(Reel.segments))
    ).first()
    if reel is None:
        raise NotFoundError("Edición de Highlights no encontrada.", code="reel_not_found")

    duration = db.get(Project, project_id).duration_seconds  # type: ignore[union-attr]
    for item in payload.segments:
        if duration is not None and item.end > duration + 0.25:
            raise ValidationAppError(
                "Un fragmento supera la duración del video.",
                code="highlight_segment_out_of_bounds",
            )
    for segment in list(reel.segments):
        db.delete(segment)
    db.flush()
    for order, item in enumerate(payload.segments):
        db.add(
            ReelSegment(
                reel_id=reel.id,
                order=order,
                source_start_seconds=item.start,
                source_end_seconds=item.end,
                transcript_text=item.transcript.strip(),
                transition_type=TransitionType(item.transition_type),
                transition_duration_ms=item.transition_duration_ms,
                selection_reason=item.reason.strip() or None,
                selection_score=item.score,
                narrative_category=item.category,
            )
        )
    reel.updated_at = _utc_now()
    plan.updated_at = _utc_now()
    db.commit()
    db.refresh(plan)
    return plan


def update_metadata(
    db: Session,
    project_id: UUID,
    payload: ContentMetadataUpdate,
) -> HighlightPlan:
    plan = get_plan(db, project_id)
    if plan.reel_id is None:
        raise ValidationAppError("No hay contenido analizado.", code="highlight_selection_missing")
    metadata = db.scalars(
        select(ContentMetadata).where(ContentMetadata.reel_id == plan.reel_id)
    ).first()
    if metadata is None:
        metadata = ContentMetadata(
            project_id=project_id,
            reel_id=plan.reel_id,
            content_kind=ContentKind.highlight.value,
        )
        db.add(metadata)
    data = payload.model_dump(exclude_unset=True)
    if "hashtags" in data:
        metadata.hashtags_json = json.dumps(data.pop("hashtags") or [], ensure_ascii=False)
    if "keywords" in data:
        metadata.keywords_json = json.dumps(data.pop("keywords") or [], ensure_ascii=False)
    for field, value in data.items():
        setattr(metadata, field, value.strip() if isinstance(value, str) else value)
    if metadata.chosen_title:
        reel = db.get(Reel, plan.reel_id)
        if reel is not None:
            reel.title = metadata.chosen_title
            reel.updated_at = _utc_now()
    metadata.updated_at = _utc_now()
    db.commit()
    db.refresh(plan)
    return plan


def to_response(db: Session, plan: HighlightPlan) -> HighlightPlanResponse:
    reel = None
    metadata = None
    if plan.reel_id:
        reel = db.scalars(
            select(Reel).where(Reel.id == plan.reel_id).options(selectinload(Reel.segments))
        ).first()
        metadata = db.scalars(
            select(ContentMetadata).where(ContentMetadata.reel_id == plan.reel_id)
        ).first()

    segments = []
    if reel is not None:
        segments = [
            HighlightSegmentResponse(
                id=item.id,
                order=item.order,
                start=item.source_start_seconds,
                end=item.source_end_seconds,
                duration=item.source_end_seconds - item.source_start_seconds,
                transcript=item.transcript_text or "",
                reason=item.selection_reason or "",
                score=float(item.selection_score or 0.0),
                category=item.narrative_category or "theme",
                transition_type=(
                    item.transition_type.value
                    if hasattr(item.transition_type, "value")
                    else str(item.transition_type)
                ),
                transition_duration_ms=item.transition_duration_ms,
            )
            for item in sorted(reel.segments, key=lambda segment: segment.order)
        ]

    metadata_response = None
    if metadata is not None:
        titles = _json_dict(metadata.suggested_titles_json)
        metadata_response = ContentMetadataResponse(
            suggested_titles=StrategicTitles.model_validate(titles) if titles else None,
            chosen_title=metadata.chosen_title,
            description=metadata.description,
            thumbnail_text=metadata.thumbnail_text,
            hashtags=[str(item) for item in _json_list(metadata.hashtags_json)],
            keywords=[str(item) for item in _json_list(metadata.keywords_json)],
        )
    confidence = plan.sermon_confidence
    return HighlightPlanResponse(
        id=plan.id,
        project_id=plan.project_id,
        reel_id=plan.reel_id,
        sermon_start=plan.sermon_start_seconds,
        sermon_end=plan.sermon_end_seconds,
        sermon_confidence=confidence,
        detection_method=plan.sermon_detection_method,
        detection_notes=plan.sermon_detection_notes,
        requires_manual_range=confidence is None or confidence < 0.68,
        target_duration_seconds=plan.target_duration_seconds,
        editorial_style=plan.editorial_style,
        subtitle_delivery=(
            plan.subtitle_delivery.value
            if hasattr(plan.subtitle_delivery, "value")
            else str(plan.subtitle_delivery)
        ),
        title_theme=plan.title_theme,
        biblical_references=[
            str(item) for item in _json_list(plan.biblical_references_json)
        ],
        segments=segments,
        estimated_duration_seconds=round(sum(item.duration for item in segments), 3),
        metadata=metadata_response,
        regeneration_history=[
            item for item in _json_list(plan.regeneration_history_json) if isinstance(item, dict)
        ],
        created_at=plan.created_at,
        updated_at=plan.updated_at,
    )


def _apply_detection(plan: HighlightPlan, result: SermonDetection) -> None:
    plan.sermon_start_seconds = result.start
    plan.sermon_end_seconds = result.end
    plan.sermon_confidence = result.confidence
    plan.sermon_detection_method = result.method
    plan.sermon_detection_notes = result.notes
    plan.updated_at = _utc_now()
