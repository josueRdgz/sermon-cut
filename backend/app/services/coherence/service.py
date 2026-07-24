"""Join-coherence validation: build views, run rules, optional AI / media."""

from __future__ import annotations

import json
import logging
from pathlib import Path
from uuid import UUID

from sqlalchemy.orm import Session

from app.core.exceptions import NotFoundError, ValidationAppError
from app.models.reel import Reel, ReelSegment
from app.models.transcript import Transcript
from app.schemas.coherence import (
    CoherenceDismissRequest,
    CoherenceExpandContextRequest,
    CoherenceIssue,
    CoherenceReport,
    CoherenceSeverity,
    CoherenceValidateRequest,
)
from app.services import projects as projects_service
from app.services import storage
from app.services.coherence import ai_review
from app.services.coherence.media import check_media_joins
from app.services.coherence.rules import (
    SegmentView,
    TranscriptWordView,
    run_text_rules,
)
from app.services.reels import service as reels_service
from app.services.transcripts import service as transcripts_service

logger = logging.getLogger(__name__)

_CONTEXT_PAD = 12.0  # seconds of deleted context for AI / dangling refs


def _parse_dismissals(raw: str | None) -> list[dict]:
    if not raw:
        return []
    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        return []
    if not isinstance(data, list):
        return []
    return [item for item in data if isinstance(item, dict)]


def _dump_dismissals(items: list[dict]) -> str:
    return json.dumps(items, ensure_ascii=False)


def _dismissal_key(code: str, segment_id: int, segment_uuid: str | None = None) -> str:
    if segment_uuid:
        return f"{code}|{segment_uuid}"
    return f"{code}|#{segment_id}"


def _is_dismissed(issue: CoherenceIssue, dismissals: list[dict]) -> bool:
    keys = {
        _dismissal_key(
            str(item.get("code", "")),
            int(item.get("segment_id", 0) or 0),
            str(item["segment_uuid"]) if item.get("segment_uuid") else None,
        )
        for item in dismissals
    }
    uuid_str = str(issue.segment_uuid) if issue.segment_uuid else None
    return (
        _dismissal_key(issue.code, issue.segment_id, uuid_str) in keys
        or _dismissal_key(issue.code, issue.segment_id, None) in keys
    )


def _overall_severity(issues: list[CoherenceIssue]) -> CoherenceSeverity:
    active = [i for i in issues if not i.dismissed]
    if any(i.severity == CoherenceSeverity.blocked for i in active):
        return CoherenceSeverity.blocked
    if any(i.severity == CoherenceSeverity.warning for i in active):
        return CoherenceSeverity.warning
    return CoherenceSeverity.valid


def _can_render(severity: CoherenceSeverity) -> bool:
    return severity == CoherenceSeverity.valid


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


def _collect_words(transcript: Transcript | None) -> list[TranscriptWordView]:
    if transcript is None:
        return []
    words: list[TranscriptWordView] = []
    for segment in transcript.segments:
        if segment.words:
            for word in sorted(segment.words, key=lambda w: w.order):
                words.append(
                    TranscriptWordView(
                        start=word.start_seconds,
                        end=word.end_seconds,
                        text=word.text,
                    )
                )
            continue
        # Approximate word spans when only segment timing exists.
        if (
            segment.start_seconds is None
            or segment.end_seconds is None
            or segment.end_seconds <= segment.start_seconds
        ):
            continue
        tokens = segment.text.split()
        if not tokens:
            continue
        span = (segment.end_seconds - segment.start_seconds) / len(tokens)
        for index, token in enumerate(tokens):
            w_start = segment.start_seconds + index * span
            words.append(
                TranscriptWordView(
                    start=w_start,
                    end=w_start + span,
                    text=token,
                )
            )
    return words


def _build_segment_views(
    ordered: list[ReelSegment],
    transcript: Transcript | None,
) -> tuple[list[SegmentView], list[str]]:
    views: list[SegmentView] = []
    deleted: list[str] = []
    prev_end: float | None = None
    for index, segment in enumerate(ordered, start=1):
        gap = 0.0 if prev_end is None else max(0.0, segment.source_start_seconds - prev_end)
        text = (segment.transcript_text or "").strip()
        if not text:
            text = _text_in_window(
                transcript, segment.source_start_seconds, segment.source_end_seconds
            )
        views.append(
            SegmentView(
                index=index,
                uuid=str(segment.id),
                start=segment.source_start_seconds,
                end=segment.source_end_seconds,
                text=text,
                gap_before=gap,
            )
        )
        if prev_end is not None and gap > 0.05:
            deleted.append(_text_in_window(transcript, prev_end, segment.source_start_seconds))
        elif index > 1:
            deleted.append("")
        prev_end = segment.source_end_seconds
    return views, deleted


def _joined_script(views: list[SegmentView]) -> str:
    return "\n\n".join(
        f"[Fragmento {view.index}] {view.text}".strip() for view in views if view.text
    )


def _surrounding_context(
    views: list[SegmentView],
    deleted: list[str],
    transcript: Transcript | None,
) -> tuple[str, str]:
    if not views:
        return "", ""
    first = views[0]
    before = _text_in_window(
        transcript,
        max(0.0, first.start - _CONTEXT_PAD),
        first.start,
    )
    after_parts: list[str] = []
    for gap_text in deleted:
        if gap_text:
            after_parts.append(gap_text)
    last = views[-1]
    after_parts.append(
        _text_in_window(transcript, last.end, last.end + _CONTEXT_PAD)
    )
    return before, "\n---\n".join(part for part in after_parts if part)


def _attach_uuids(
    issues: list[CoherenceIssue],
    views: list[SegmentView],
) -> list[CoherenceIssue]:
    by_index = {view.index: view for view in views}
    out: list[CoherenceIssue] = []
    for issue in issues:
        view = by_index.get(issue.segment_id)
        uuid_value = UUID(view.uuid) if view and view.uuid else issue.segment_uuid
        out.append(issue.model_copy(update={"segment_uuid": uuid_value}))
    return out


def _apply_dismissals(
    issues: list[CoherenceIssue],
    dismissals: list[dict],
) -> list[CoherenceIssue]:
    out: list[CoherenceIssue] = []
    for issue in issues:
        dismissed = False
        if issue.severity != CoherenceSeverity.blocked:
            dismissed = _is_dismissed(issue, dismissals)
        out.append(issue.model_copy(update={"dismissed": dismissed}))
    return out


def _summary(severity: CoherenceSeverity, issues: list[CoherenceIssue]) -> str:
    active = [i for i in issues if not i.dismissed]
    blocked = sum(1 for i in active if i.severity == CoherenceSeverity.blocked)
    warnings = sum(1 for i in active if i.severity == CoherenceSeverity.warning)
    if severity == CoherenceSeverity.valid:
        ignored = sum(1 for i in issues if i.dismissed)
        if ignored:
            return f"Unión coherente (se ignoraron {ignored} advertencia(s))."
        return "Unión coherente: no se detectaron problemas activos."
    if blocked:
        return (
            f"Hay {blocked} problema(s) bloqueante(s) y {warnings} advertencia(s). "
            "Corrige los bloqueos antes de renderizar."
        )
    return (
        f"Hay {warnings} advertencia(s). Puedes ignorarlas, editar tiempos, "
        "añadir contexto o eliminar el fragmento."
    )


def validate_reel(
    db: Session,
    project_id: UUID,
    reel_id: UUID,
    options: CoherenceValidateRequest | None = None,
    *,
    media_runner=None,
) -> CoherenceReport:
    """Run deterministic (+ optional media/AI) coherence checks for a Reel."""
    options = options or CoherenceValidateRequest()
    project = projects_service.get_project(db, project_id)
    reel = reels_service.get_reel_for_project(db, project_id, reel_id)
    ordered = sorted(reel.segments, key=lambda s: s.order)

    transcript: Transcript | None = None
    try:
        transcript = transcripts_service.get_transcript_for_project(db, project_id)
    except NotFoundError:
        transcript = None

    views, deleted = _build_segment_views(ordered, transcript)
    words = _collect_words(transcript)
    issues = run_text_rules(views, words=words, deleted_context=deleted)

    media_probed = False
    if options.include_media_probes and project.video_filename and len(views) >= 2:
        source = storage.resolve_inside_project(project_id, project.video_filename)
        if source.is_file():
            kwargs = {"source": source}
            if media_runner is not None:
                kwargs["runner"] = media_runner
            issues.extend(check_media_joins(views, **kwargs))
            media_probed = True

    ai_reviewed = False
    if options.include_ai_review and views:
        before, after = _surrounding_context(views, deleted, transcript)
        issues.extend(
            ai_review.review_joined_script(
                joined_script=_joined_script(views),
                before_context=before,
                after_context=after,
                segment_count=len(views),
            )
        )
        ai_reviewed = True

    issues = _attach_uuids(issues, views)
    dismissals = _parse_dismissals(getattr(reel, "coherence_dismissals_json", None))
    issues = _apply_dismissals(issues, dismissals)
    # Stable order: blocked first, then warnings, then dismissed.
    severity_rank = {
        CoherenceSeverity.blocked: 0,
        CoherenceSeverity.warning: 1,
        CoherenceSeverity.valid: 2,
    }
    issues.sort(
        key=lambda i: (
            1 if i.dismissed else 0,
            severity_rank.get(i.severity, 9),
            i.segment_id,
            i.code,
        )
    )
    severity = _overall_severity(issues)
    return CoherenceReport(
        severity=severity,
        issues=issues,
        joined_script=_joined_script(views),
        ai_reviewed=ai_reviewed,
        media_probed=media_probed,
        can_render=_can_render(severity),
        summary=_summary(severity, issues),
    )


def dismiss_warning(
    db: Session,
    project_id: UUID,
    reel_id: UUID,
    payload: CoherenceDismissRequest,
) -> CoherenceReport:
    """Persist an ignored warning; blocked findings are rejected."""
    reel = reels_service.get_reel_for_project(db, project_id, reel_id)
    ordered = sorted(reel.segments, key=lambda s: s.order)
    if payload.segment_id < 1 or payload.segment_id > len(ordered):
        raise ValidationAppError(
            "segment_id fuera de rango.",
            code="invalid_segment_id",
        )

    # Re-run text rules (no AI/media) to confirm the finding exists and is dismissable.
    probe = validate_reel(
        db,
        project_id,
        reel_id,
        CoherenceValidateRequest(include_ai_review=False, include_media_probes=False),
    )
    match = next(
        (
            issue
            for issue in probe.issues
            if issue.code == payload.code and issue.segment_id == payload.segment_id
        ),
        None,
    )
    if match is None:
        raise ValidationAppError(
            "No hay una advertencia con ese código en el fragmento indicado.",
            code="warning_not_found",
        )
    if match.severity == CoherenceSeverity.blocked:
        raise ValidationAppError(
            "Los hallazgos bloqueantes no se pueden ignorar; corrige el corte.",
            code="cannot_dismiss_blocked",
        )

    dismissals = _parse_dismissals(reel.coherence_dismissals_json)
    entry = {
        "code": payload.code,
        "segment_id": payload.segment_id,
        "segment_uuid": str(match.segment_uuid) if match.segment_uuid else None,
    }
    key = _dismissal_key(payload.code, payload.segment_id, entry["segment_uuid"])
    existing_keys = {
        _dismissal_key(
            str(item.get("code", "")),
            int(item.get("segment_id", 0) or 0),
            str(item["segment_uuid"]) if item.get("segment_uuid") else None,
        )
        for item in dismissals
    }
    if key not in existing_keys:
        dismissals.append(entry)
        reel.coherence_dismissals_json = _dump_dismissals(dismissals)
        reels_service._touch(reel)  # noqa: SLF001 — shared timestamp helper
        db.commit()

    return validate_reel(
        db,
        project_id,
        reel_id,
        CoherenceValidateRequest(include_ai_review=False, include_media_probes=False),
    )


def expand_segment_context(
    db: Session,
    project_id: UUID,
    reel_id: UUID,
    payload: CoherenceExpandContextRequest,
) -> Reel:
    """Widen a Reel segment by neighbouring seconds and refresh transcript text."""
    project = projects_service.get_project(db, project_id)
    reel = reels_service.get_reel_for_project(db, project_id, reel_id)
    ordered = sorted(reel.segments, key=lambda s: s.order)
    if payload.segment_id < 1 or payload.segment_id > len(ordered):
        raise ValidationAppError(
            "segment_id fuera de rango.",
            code="invalid_segment_id",
        )
    segment = ordered[payload.segment_id - 1]
    video_duration = project.duration_seconds
    new_start = max(0.0, segment.source_start_seconds - payload.before_seconds)
    new_end = segment.source_end_seconds + payload.after_seconds
    if video_duration is not None:
        new_end = min(new_end, video_duration)

    transcript: Transcript | None = None
    try:
        transcript = transcripts_service.get_transcript_for_project(db, project_id)
    except NotFoundError:
        transcript = None
    refreshed = _text_in_window(transcript, new_start, new_end)

    from app.schemas.reel import ReelSegmentUpdate

    return reels_service.update_segment(
        db,
        project_id,
        reel_id,
        segment.id,
        ReelSegmentUpdate(
            source_start_seconds=new_start,
            source_end_seconds=new_end,
            transcript_text=refreshed or segment.transcript_text,
        ),
    )


def assert_render_allowed(db: Session, project_id: UUID, reel_id: UUID) -> None:
    """Soft server-side gate: refuse render when undismissed blocks remain."""
    report = validate_reel(
        db,
        project_id,
        reel_id,
        CoherenceValidateRequest(include_ai_review=False, include_media_probes=False),
    )
    if report.severity == CoherenceSeverity.blocked:
        first = next(
            (
                i
                for i in report.issues
                if not i.dismissed and i.severity == CoherenceSeverity.blocked
            ),
            None,
        )
        detail = first.message if first else report.summary
        raise ValidationAppError(
            f"La unión del Reel no es coherente: {detail}",
            code="coherence_blocked",
        )
