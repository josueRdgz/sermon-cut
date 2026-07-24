"""Optional technical cut suggestions: generate, accept, reject.

Suggestions never modify a Reel until the user explicitly accepts one.
Accepting refreshes ``transcript_text`` so subtitle cues remap on the next
preview/render without a separate subtitle cache.
"""

from __future__ import annotations

import json
import logging
from pathlib import Path
from uuid import UUID

from sqlalchemy.orm import Session

from app.core.exceptions import NotFoundError, ValidationAppError
from app.models.reel import Reel, TransitionType
from app.models.transcript import Transcript
from app.schemas.cut_suggestions import (
    CutIntensity,
    CutSuggestion,
    CutSuggestionActionResponse,
    CutSuggestionsReport,
    CutSuggestionStatus,
    CutSuggestRequest,
)
from app.schemas.reel import ReelSegmentCreate, ReelSegmentUpdate
from app.services import projects as projects_service
from app.services import storage
from app.services.cut_suggestions.engine import SegmentInput, build_suggestions
from app.services.cut_suggestions.intensity import get_profile
from app.services.cut_suggestions.silence import SilenceInterval, detect_silences
from app.services.reels import service as reels_service
from app.services.transcripts import service as transcripts_service

logger = logging.getLogger(__name__)


def _text_in_window(transcript: Transcript | None, start: float, end: float) -> str:
    if transcript is None:
        return ""
    parts: list[str] = []
    for segment in sorted(transcript.segments, key=lambda s: s.order):
        if segment.start_seconds is None or segment.end_seconds is None:
            continue
        if segment.end_seconds <= start or segment.start_seconds >= end:
            continue
        parts.append(segment.text.strip())
    return " ".join(parts).strip()


def _words_in_window(
    transcript: Transcript | None, start: float, end: float
) -> list[tuple[str, float, float]]:
    if transcript is None:
        return []
    words: list[tuple[str, float, float]] = []
    for segment in transcript.segments:
        if segment.words:
            for word in sorted(segment.words, key=lambda w: w.order):
                if word.end_seconds < start or word.start_seconds > end:
                    continue
                words.append((word.text, word.start_seconds, word.end_seconds))
            continue
        if (
            segment.start_seconds is None
            or segment.end_seconds is None
            or segment.end_seconds <= start
            or segment.start_seconds >= end
        ):
            continue
        tokens = segment.text.split()
        if not tokens:
            continue
        span = (segment.end_seconds - segment.start_seconds) / len(tokens)
        for index, token in enumerate(tokens):
            w_start = segment.start_seconds + index * span
            w_end = w_start + span
            if w_end < start or w_start > end:
                continue
            words.append((token, w_start, w_end))
    return words


def _load_suggestions(reel: Reel) -> list[CutSuggestion]:
    raw = getattr(reel, "cut_suggestions_json", None)
    if not raw:
        return []
    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        return []
    if not isinstance(data, list):
        return []
    out: list[CutSuggestion] = []
    for item in data:
        try:
            out.append(CutSuggestion.model_validate(item))
        except Exception:  # noqa: BLE001 — skip corrupt rows
            continue
    return out


def _save_suggestions(db: Session, reel: Reel, suggestions: list[CutSuggestion]) -> None:
    reel.cut_suggestions_json = json.dumps(
        [item.model_dump(mode="json") for item in suggestions],
        ensure_ascii=False,
    )
    reels_service._touch(reel)  # noqa: SLF001
    db.commit()


def _report(intensity: CutIntensity, suggestions: list[CutSuggestion]) -> CutSuggestionsReport:
    pending = [s for s in suggestions if s.status == CutSuggestionStatus.pending]
    return CutSuggestionsReport(
        intensity=intensity,
        suggestions=suggestions,
        pending_count=len(pending),
        summary=(
            f"{len(pending)} sugerencia(s) pendiente(s) "
            f"(intensidad {intensity.value}). Ninguna se aplica sola."
            if pending
            else f"Sin sugerencias pendientes (intensidad {intensity.value})."
        ),
        auto_applied=False,
    )


def _active_intensity(suggestions: list[CutSuggestion]) -> CutIntensity:
    for item in suggestions:
        return item.intensity
    return CutIntensity.conservative


def generate_suggestions(
    db: Session,
    project_id: UUID,
    reel_id: UUID,
    options: CutSuggestRequest | None = None,
    *,
    silence_runner=None,
) -> CutSuggestionsReport:
    """Analyze the Reel and replace the stored suggestion list (pending only)."""
    options = options or CutSuggestRequest()
    profile = get_profile(options.intensity)
    project = projects_service.get_project(db, project_id)
    reel = reels_service.get_reel_for_project(db, project_id, reel_id)
    ordered = sorted(reel.segments, key=lambda s: s.order)
    if not ordered:
        raise ValidationAppError(
            "El Reel no tiene fragmentos para analizar.",
            code="reel_empty",
        )

    transcript: Transcript | None = None
    try:
        transcript = transcripts_service.get_transcript_for_project(db, project_id)
    except NotFoundError:
        transcript = None

    source: Path | None = None
    if project.video_filename:
        candidate = storage.resolve_inside_project(project_id, project.video_filename)
        if candidate.is_file():
            source = candidate

    segment_inputs: list[SegmentInput] = []
    silences_by_segment: dict[int, list[SilenceInterval]] = {}
    for index, segment in enumerate(ordered, start=1):
        segment_inputs.append(
            SegmentInput(
                index=index,
                uuid=segment.id,
                start=segment.source_start_seconds,
                end=segment.source_end_seconds,
                words=_words_in_window(
                    transcript,
                    segment.source_start_seconds,
                    segment.source_end_seconds,
                ),
            )
        )
        if options.include_silence and source is not None:
            kwargs = {
                "source": source,
                "start": segment.source_start_seconds,
                "end": segment.source_end_seconds,
                "profile": profile,
            }
            if silence_runner is not None:
                kwargs["runner"] = silence_runner
            silences_by_segment[index] = detect_silences(**kwargs)
        else:
            silences_by_segment[index] = []

    fresh = build_suggestions(
        segment_inputs,
        silences_by_segment=silences_by_segment,
        profile=profile,
        intensity=options.intensity,
        include_silence=options.include_silence,
        include_fillers=options.include_fillers,
    )

    # Preserve previously rejected fingerprints so regenerate does not nag.
    previous = _load_suggestions(reel)
    rejected_keys = {
        _fingerprint(item)
        for item in previous
        if item.status == CutSuggestionStatus.rejected
    }
    kept_rejected = [
        item for item in previous if item.status == CutSuggestionStatus.rejected
    ]
    pending = [item for item in fresh if _fingerprint(item) not in rejected_keys]
    store = pending + kept_rejected
    _save_suggestions(db, reel, store)
    return _report(options.intensity, store)


def list_suggestions(
    db: Session, project_id: UUID, reel_id: UUID
) -> CutSuggestionsReport:
    reel = reels_service.get_reel_for_project(db, project_id, reel_id)
    suggestions = _load_suggestions(reel)
    return _report(_active_intensity(suggestions), suggestions)


def reject_suggestion(
    db: Session, project_id: UUID, reel_id: UUID, suggestion_id: UUID
) -> CutSuggestionActionResponse:
    reel = reels_service.get_reel_for_project(db, project_id, reel_id)
    suggestions = _load_suggestions(reel)
    target = next((s for s in suggestions if s.id == suggestion_id), None)
    if target is None:
        raise NotFoundError("Sugerencia no encontrada.", code="cut_suggestion_not_found")
    if target.status != CutSuggestionStatus.pending:
        raise ValidationAppError(
            "Solo se pueden rechazar sugerencias pendientes.",
            code="suggestion_not_pending",
        )
    updated = target.model_copy(update={"status": CutSuggestionStatus.rejected})
    suggestions = [updated if s.id == suggestion_id else s for s in suggestions]
    _save_suggestions(db, reel, suggestions)
    reel = reels_service.get_reel_for_project(db, project_id, reel_id)
    return CutSuggestionActionResponse(
        suggestion=updated,
        report=_report(_active_intensity(suggestions), suggestions),
        reel_id=reel_id,
        reel=reels_service.to_response(reel),
        subtitles_stale=False,
        note="Sugerencia rechazada. El Reel no cambió.",
    )


def accept_suggestion(
    db: Session, project_id: UUID, reel_id: UUID, suggestion_id: UUID
) -> CutSuggestionActionResponse:
    """Apply one suggestion after explicit approval; refresh transcript text."""
    reel = reels_service.get_reel_for_project(db, project_id, reel_id)
    suggestions = _load_suggestions(reel)
    target = next((s for s in suggestions if s.id == suggestion_id), None)
    if target is None:
        raise NotFoundError("Sugerencia no encontrada.", code="cut_suggestion_not_found")
    if target.status != CutSuggestionStatus.pending:
        raise ValidationAppError(
            "Solo se pueden aceptar sugerencias pendientes.",
            code="suggestion_not_pending",
        )

    transcript: Transcript | None = None
    try:
        transcript = transcripts_service.get_transcript_for_project(db, project_id)
    except NotFoundError:
        transcript = None

    if target.split:
        _apply_split(db, project_id, reel_id, target, transcript)
    else:
        _apply_edge_trim(db, project_id, reel_id, target, transcript)

    # Segment UUIDs / indices may have changed after a split — drop stale pendings
    # for the same segment and mark this one accepted.
    reel = reels_service.get_reel_for_project(db, project_id, reel_id)
    remaining = _load_suggestions(reel)
    accepted = target.model_copy(update={"status": CutSuggestionStatus.accepted})
    cleaned: list[CutSuggestion] = []
    for item in remaining:
        if item.id == suggestion_id:
            cleaned.append(accepted)
            continue
        if (
            item.status == CutSuggestionStatus.pending
            and item.segment_uuid == target.segment_uuid
        ):
            # Invalidate siblings that targeted the old window.
            continue
        cleaned.append(item)
    if not any(s.id == suggestion_id for s in cleaned):
        cleaned.append(accepted)
    _save_suggestions(db, reel, cleaned)
    reel = reels_service.get_reel_for_project(db, project_id, reel_id)

    return CutSuggestionActionResponse(
        suggestion=accepted,
        report=_report(_active_intensity(cleaned), cleaned),
        reel_id=reel_id,
        reel=reels_service.to_response(reel),
        subtitles_stale=True,
        note=(
            "Corte aplicado. Los subtítulos se recalculan desde las nuevas "
            "ventanas del Reel en la siguiente vista previa o render."
        ),
    )


def _apply_edge_trim(
    db: Session,
    project_id: UUID,
    reel_id: UUID,
    suggestion: CutSuggestion,
    transcript: Transcript | None,
) -> None:
    if suggestion.new_start is None or suggestion.new_end is None:
        raise ValidationAppError(
            "La sugerencia no incluye tiempos de recorte.",
            code="invalid_suggestion",
        )
    if suggestion.new_end <= suggestion.new_start:
        raise ValidationAppError(
            "Tiempos de recorte inválidos.",
            code="invalid_suggestion",
        )
    text = _text_in_window(transcript, suggestion.new_start, suggestion.new_end)
    reels_service.update_segment(
        db,
        project_id,
        reel_id,
        suggestion.segment_uuid,
        ReelSegmentUpdate(
            source_start_seconds=suggestion.new_start,
            source_end_seconds=suggestion.new_end,
            transcript_text=text or None,
        ),
    )


def _apply_split(
    db: Session,
    project_id: UUID,
    reel_id: UUID,
    suggestion: CutSuggestion,
    transcript: Transcript | None,
) -> None:
    if suggestion.keep_before_end is None or suggestion.keep_after_start is None:
        raise ValidationAppError(
            "La sugerencia de división está incompleta.",
            code="invalid_suggestion",
        )
    reel = reels_service.get_reel_for_project(db, project_id, reel_id)
    segment = next((s for s in reel.segments if s.id == suggestion.segment_uuid), None)
    if segment is None:
        raise NotFoundError("Fragmento no encontrado.", code="reel_segment_not_found")

    original_end = segment.source_end_seconds
    original_start = segment.source_start_seconds
    before_end = suggestion.keep_before_end
    after_start = suggestion.keep_after_start
    if not (original_start < before_end < after_start < original_end):
        raise ValidationAppError(
            "La división cae fuera del fragmento.",
            code="invalid_split",
        )

    left_text = _text_in_window(transcript, original_start, before_end)
    right_text = _text_in_window(transcript, after_start, original_end)
    crossfade = max(80, min(5000, suggestion.apply_crossfade_ms))

    # Update left half with short crossfade into the new right half.
    reels_service.update_segment(
        db,
        project_id,
        reel_id,
        suggestion.segment_uuid,
        ReelSegmentUpdate(
            source_start_seconds=original_start,
            source_end_seconds=before_end,
            transcript_text=left_text or None,
            transition_type=TransitionType.short_crossfade,
            transition_duration_ms=crossfade,
        ),
    )
    # Insert right half immediately after the original order.
    reels_service.add_segment(
        db,
        project_id,
        reel_id,
        ReelSegmentCreate(
            source_start_seconds=after_start,
            source_end_seconds=original_end,
            transcript_text=right_text or None,
            transition_type=TransitionType.hard_cut,
            transition_duration_ms=0,
            order=segment.order + 1,
        ),
    )


def _fingerprint(suggestion: CutSuggestion) -> str:
    return (
        f"{suggestion.kind.value}|{suggestion.segment_uuid}|"
        f"{suggestion.region_start:.3f}|{suggestion.region_end:.3f}|"
        f"{suggestion.matched_text or ''}"
    )
