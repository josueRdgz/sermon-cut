"""Subtitle template listing and live preview for the reel editor."""

from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.core.exceptions import NotFoundError
from app.db.session import get_db
from app.models.reel import SubtitleStyle
from app.schemas.subtitles import (
    SubtitleCuePreview,
    SubtitlePreviewResponse,
    SubtitleTemplateInfo,
    SubtitleTemplateListResponse,
)
from app.services.reels import service as reels_service
from app.services.subtitles import (
    caption_windows_for_segments,
    options_for_reel,
    transcript_to_source_segments,
)
from app.services.subtitles.cues import build_cues_for_reel
from app.services.subtitles.templates import TEMPLATES
from app.services.subtitles.timeline import TimelineSegment
from app.services.transcripts import service as transcripts_service

router = APIRouter(tags=["subtitles"])


@router.get("/subtitle-templates", response_model=SubtitleTemplateListResponse)
def list_subtitle_templates() -> SubtitleTemplateListResponse:
    items = [
        SubtitleTemplateInfo(
            id=SubtitleStyle(template.id),
            label=template.label,
            description=template.description,
            max_lines=template.max_lines,
            highlight_current_word=template.highlight_current_word,
            quote_style=template.quote_style,
            default_font_size=template.default_font_size,
            default_max_words=template.default_max_words,
            default_uppercase=template.default_uppercase,
            default_margin_bottom=template.default_margin_bottom,
            default_granularity=template.default_granularity.value,  # type: ignore[arg-type]
        )
        for template in TEMPLATES.values()
    ]
    return SubtitleTemplateListResponse(items=items)


@router.get(
    "/projects/{project_id}/reels/{reel_id}/subtitle-preview",
    response_model=SubtitlePreviewResponse,
)
def preview_subtitles(
    project_id: UUID,
    reel_id: UUID,
    db: Session = Depends(get_db),
) -> SubtitlePreviewResponse:
    """Return remapped cues on the final timeline for the on-player preview."""
    reel = reels_service.get_reel_for_project(db, project_id, reel_id)
    options = options_for_reel(reel)
    try:
        transcript = transcripts_service.get_transcript_for_project(db, project_id)
    except NotFoundError:
        transcript = None

    ordered = sorted(reel.segments, key=lambda s: s.order)
    result = build_cues_for_reel(
        reel_segments=[
            TimelineSegment(
                source_start=item.source_start_seconds,
                source_end=item.source_end_seconds,
                transition_type=item.transition_type.value,
                transition_duration_ms=item.transition_duration_ms,
            )
            for item in ordered
        ],
        transcript_segments=transcript_to_source_segments(transcript),
        fallback_texts=[item.transcript_text for item in ordered],
        options=options,
        caption_windows=caption_windows_for_segments(ordered),
    )
    cues = [
        SubtitleCuePreview(
            start=cue.start,
            end=cue.end,
            text=cue.text.replace("\\N", "\n"),
            highlight=cue.highlight,
            words=[
                {"text": word.text, "start": word.start, "end": word.end}
                for word in cue.words
            ],
        )
        for cue in result.cues
    ]
    return SubtitlePreviewResponse(
        style=options.style,
        granularity_used=result.granularity_used.value,  # type: ignore[arg-type]
        total_duration_seconds=result.total_duration,
        cues=cues,
        position=options.position.value,  # type: ignore[arg-type]
        font_size=options.font_size,
        uppercase=options.uppercase,
        opacity=options.opacity,
        margin_bottom=options.margin_bottom,
        max_words=options.max_words,
    )
