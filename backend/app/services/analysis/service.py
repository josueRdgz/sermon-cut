"""Persist, list and approve AI analysis candidates."""

from __future__ import annotations

import json
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.core.exceptions import ConflictError, NotFoundError, ValidationAppError
from app.models.analysis import AnalysisCandidate, AnalysisCandidateStatus, AnalysisJob
from app.models.highlight import ContentMetadata
from app.models.reel import AspectRatio
from app.schemas.analysis import (
    AnalysisCandidateResponse,
    AnalysisCandidateSegment,
    AnalysisJobResponse,
)
from app.schemas.reel import ReelCreate, ReelSegmentCreate
from app.services.analysis.validate import ValidatedClip
from app.services.reels import service as reels_service


def _parse_json_list(raw: str | None) -> list:
    if not raw:
        return []
    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        return []
    return data if isinstance(data, list) else []


def candidate_to_response(candidate: AnalysisCandidate) -> AnalysisCandidateResponse:
    segments_raw = _parse_json_list(candidate.segments_json)
    segments = [
        AnalysisCandidateSegment(
            start=float(item.get("start", 0)),
            end=float(item.get("end", 0)),
            exact_text=str(item.get("exact_text", "")),
            reason=str(item.get("reason", "")),
            match_ratio=item.get("match_ratio"),
            snapped=bool(item.get("snapped", False)),
        )
        for item in segments_raw
        if isinstance(item, dict)
    ]
    return AnalysisCandidateResponse(
        id=candidate.id,
        job_id=candidate.job_id,
        project_id=candidate.project_id,
        rank=candidate.rank,
        status=candidate.status.value
        if hasattr(candidate.status, "value")
        else str(candidate.status),
        title=candidate.title,
        hook=candidate.hook,
        summary=candidate.summary,
        editorial_score=candidate.editorial_score,
        confidence=candidate.confidence,
        joined_script=candidate.joined_script,
        caption=candidate.caption,
        hashtags=[str(tag) for tag in _parse_json_list(candidate.hashtags_json)],
        suggested_titles={
            str(key): str(value)
            for key, value in _parse_json_object(candidate.suggested_titles_json).items()
        },
        thumbnail_text=candidate.thumbnail_text,
        keywords=[str(item) for item in _parse_json_list(candidate.keywords_json)],
        segments=segments,
        warnings=[str(item) for item in _parse_json_list(candidate.warnings_json)],
        removed_context_warning=candidate.removed_context_warning,
        accepted_reel_id=candidate.accepted_reel_id,
        created_at=candidate.created_at,
        updated_at=candidate.updated_at,
    )


def job_to_response(job: AnalysisJob) -> AnalysisJobResponse:
    candidates = [
        candidate_to_response(item) for item in sorted(job.candidates, key=lambda c: c.rank)
    ]
    return AnalysisJobResponse(
        id=job.id,
        project_id=job.project_id,
        status=job.status.value if hasattr(job.status, "value") else str(job.status),
        stage=job.stage,
        provider=job.provider,
        max_reels=job.max_reels,
        min_duration_seconds=job.min_duration_seconds,
        max_duration_seconds=job.max_duration_seconds,
        additional_instructions=job.additional_instructions,
        doctrinal_orientation=job.doctrinal_orientation,
        progress=job.progress,
        chunk_count=job.chunk_count,
        chunks_completed=job.chunks_completed,
        prompt_tokens=job.prompt_tokens,
        completion_tokens=job.completion_tokens,
        total_tokens=job.total_tokens,
        rejected_count=job.rejected_count,
        notice=job.notice,
        error_message=job.error_message,
        created_at=job.created_at,
        updated_at=job.updated_at,
        started_at=job.started_at,
        finished_at=job.finished_at,
        candidates=candidates,
    )


def persist_candidates(
    db: Session,
    *,
    job: AnalysisJob,
    clips: list[ValidatedClip],
) -> list[AnalysisCandidate]:
    """Replace any previous candidates for this job with the new validated set."""
    for existing in list(job.candidates):
        db.delete(existing)
    db.flush()

    created: list[AnalysisCandidate] = []
    for rank, clip in enumerate(clips):
        row = AnalysisCandidate(
            job_id=job.id,
            project_id=job.project_id,
            rank=rank,
            status=AnalysisCandidateStatus.pending,
            title=clip.title,
            hook=clip.hook or None,
            summary=clip.summary or None,
            editorial_score=clip.editorial_score,
            confidence=clip.confidence,
            joined_script=clip.joined_script or None,
            caption=clip.caption or None,
            hashtags_json=json.dumps(clip.hashtags, ensure_ascii=False),
            suggested_titles_json=json.dumps(clip.suggested_titles, ensure_ascii=False),
            thumbnail_text=clip.thumbnail_text or None,
            keywords_json=json.dumps(clip.keywords, ensure_ascii=False),
            segments_json=json.dumps(
                [
                    {
                        "start": seg.start,
                        "end": seg.end,
                        "exact_text": seg.exact_text,
                        "reason": seg.reason,
                        "match_ratio": seg.match_ratio,
                        "snapped": seg.snapped,
                    }
                    for seg in clip.segments
                ],
                ensure_ascii=False,
            ),
            warnings_json=json.dumps(clip.warnings, ensure_ascii=False),
            removed_context_warning=clip.removed_context_warning,
        )
        db.add(row)
        created.append(row)
    db.commit()
    return created


def get_job(db: Session, job_id: UUID) -> AnalysisJob:
    job = db.scalars(
        select(AnalysisJob)
        .where(AnalysisJob.id == job_id)
        .options(selectinload(AnalysisJob.candidates))
    ).first()
    if job is None:
        raise NotFoundError("Analysis job not found.", code="analysis_job_not_found")
    return job


def get_latest_job(db: Session, project_id: UUID) -> AnalysisJob | None:
    return db.scalars(
        select(AnalysisJob)
        .where(AnalysisJob.project_id == project_id)
        .options(selectinload(AnalysisJob.candidates))
        .order_by(AnalysisJob.created_at.desc())
    ).first()


def list_candidates(
    db: Session,
    project_id: UUID,
    *,
    job_id: UUID | None = None,
) -> list[AnalysisCandidate]:
    query = select(AnalysisCandidate).where(AnalysisCandidate.project_id == project_id)
    if job_id is not None:
        query = query.where(AnalysisCandidate.job_id == job_id)
    return list(
        db.scalars(
            query.order_by(AnalysisCandidate.rank.asc(), AnalysisCandidate.created_at.desc())
        )
    )


def get_candidate(db: Session, project_id: UUID, candidate_id: UUID) -> AnalysisCandidate:
    candidate = db.get(AnalysisCandidate, candidate_id)
    if candidate is None or candidate.project_id != project_id:
        raise NotFoundError("Candidate not found.", code="analysis_candidate_not_found")
    return candidate


def reject_candidate(db: Session, project_id: UUID, candidate_id: UUID) -> AnalysisCandidate:
    candidate = get_candidate(db, project_id, candidate_id)
    if candidate.status == AnalysisCandidateStatus.accepted:
        raise ConflictError(
            "This candidate was already accepted as a Reel.",
            code="candidate_already_accepted",
        )
    candidate.status = AnalysisCandidateStatus.rejected
    db.commit()
    db.refresh(candidate)
    return candidate


def accept_candidate(
    db: Session,
    project_id: UUID,
    candidate_id: UUID,
    *,
    aspect_ratio: AspectRatio = AspectRatio.nine_sixteen,
) -> tuple[AnalysisCandidate, UUID]:
    """Create a Reel from the candidate. Never auto-renders."""
    candidate = get_candidate(db, project_id, candidate_id)
    if candidate.status == AnalysisCandidateStatus.accepted and candidate.accepted_reel_id:
        return candidate, candidate.accepted_reel_id
    if candidate.status == AnalysisCandidateStatus.rejected:
        raise ConflictError(
            "This candidate was discarded.",
            code="candidate_rejected",
        )

    segments_raw = _parse_json_list(candidate.segments_json)
    if not segments_raw:
        raise ValidationAppError(
            "Candidate has no segments to accept.",
            code="candidate_empty",
        )

    payload = ReelCreate(
        title=candidate.title,
        hook=candidate.hook,
        description=candidate.summary,
        editorial_score=candidate.editorial_score,
        aspect_ratio=aspect_ratio,
        segments=[
            ReelSegmentCreate(
                source_start_seconds=float(item["start"]),
                source_end_seconds=float(item["end"]),
                transcript_text=str(item.get("exact_text") or None),
            )
            for item in segments_raw
            if isinstance(item, dict)
        ],
    )
    reel = reels_service.create_reel(db, project_id, payload)
    candidate.status = AnalysisCandidateStatus.accepted
    candidate.accepted_reel_id = reel.id
    metadata = ContentMetadata(
        project_id=project_id,
        reel_id=reel.id,
        content_kind="short",
        suggested_titles_json=candidate.suggested_titles_json or "{}",
        chosen_title=(
            _parse_json_object(candidate.suggested_titles_json).get("recommended")
            or candidate.title
        ),
        description=candidate.caption or candidate.summary,
        thumbnail_text=candidate.thumbnail_text,
        hashtags_json=candidate.hashtags_json or "[]",
        keywords_json=candidate.keywords_json or "[]",
    )
    db.add(metadata)
    db.commit()
    db.refresh(candidate)
    return candidate, reel.id


def _parse_json_object(raw: str | None) -> dict:
    if not raw:
        return {}
    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        return {}
    return data if isinstance(data, dict) else {}


def _apply_clip_to_candidate(row: AnalysisCandidate, clip: ValidatedClip, *, rank: int | None = None) -> None:
    if rank is not None:
        row.rank = rank
    row.status = AnalysisCandidateStatus.pending
    row.title = clip.title
    row.hook = clip.hook or None
    row.summary = clip.summary or None
    row.editorial_score = clip.editorial_score
    row.confidence = clip.confidence
    row.joined_script = clip.joined_script or None
    row.caption = clip.caption or None
    row.hashtags_json = json.dumps(clip.hashtags, ensure_ascii=False)
    row.suggested_titles_json = json.dumps(clip.suggested_titles, ensure_ascii=False)
    row.thumbnail_text = clip.thumbnail_text or None
    row.keywords_json = json.dumps(clip.keywords, ensure_ascii=False)
    row.segments_json = json.dumps(
        [
            {
                "start": seg.start,
                "end": seg.end,
                "exact_text": seg.exact_text,
                "reason": seg.reason,
                "match_ratio": seg.match_ratio,
                "snapped": seg.snapped,
            }
            for seg in clip.segments
        ],
        ensure_ascii=False,
    )
    row.warnings_json = json.dumps(clip.warnings, ensure_ascii=False)
    row.removed_context_warning = clip.removed_context_warning
    row.accepted_reel_id = None


def merge_candidates(
    db: Session,
    project_id: UUID,
    candidate_ids: list[UUID],
) -> AnalysisCandidate:
    """Join pending candidates into a new one without accepting a Reel."""
    if len(candidate_ids) < 2:
        raise ValidationAppError("Selecciona al menos dos candidatos.", code="merge_too_few")
    unique_ids = list(dict.fromkeys(candidate_ids))
    rows = [get_candidate(db, project_id, item) for item in unique_ids]
    job_ids = {row.job_id for row in rows}
    if len(job_ids) != 1:
        raise ValidationAppError(
            "Solo se pueden unir candidatos del mismo análisis.",
            code="merge_job_mismatch",
        )
    for row in rows:
        if row.status != AnalysisCandidateStatus.pending:
            raise ConflictError(
                "Solo se unen candidatos pendientes.",
                code="merge_not_pending",
            )

    segments: list[dict] = []
    titles: list[str] = []
    warnings: list[str] = []
    for row in rows:
        titles.append(row.title)
        warnings.extend(str(item) for item in _parse_json_list(row.warnings_json))
        for item in _parse_json_list(row.segments_json):
            if isinstance(item, dict):
                segments.append(item)
    segments.sort(key=lambda item: float(item.get("start", 0)))
    merged_segments: list[dict] = []
    for item in segments:
        if merged_segments and float(item["start"]) <= float(merged_segments[-1]["end"]) + 0.15:
            prev = merged_segments[-1]
            prev["end"] = max(float(prev["end"]), float(item["end"]))
            prev["exact_text"] = f"{prev.get('exact_text', '')} {item.get('exact_text', '')}".strip()
        else:
            merged_segments.append(dict(item))
    if not merged_segments:
        raise ValidationAppError("No hay fragmentos para unir.", code="merge_empty")

    job = get_job(db, rows[0].job_id)
    next_rank = max((item.rank for item in job.candidates), default=0) + 1
    joined = " ".join(str(item.get("exact_text") or "") for item in merged_segments).strip()
    row = AnalysisCandidate(
        job_id=job.id,
        project_id=project_id,
        rank=next_rank,
        status=AnalysisCandidateStatus.pending,
        title=" + ".join(titles)[:300],
        hook=rows[0].hook,
        summary=joined[:500] or None,
        editorial_score=round(sum(item.editorial_score for item in rows) / len(rows), 2),
        confidence=min(item.confidence for item in rows),
        joined_script=joined or None,
        caption=rows[0].caption,
        hashtags_json=rows[0].hashtags_json,
        suggested_titles_json=rows[0].suggested_titles_json,
        thumbnail_text=rows[0].thumbnail_text,
        keywords_json=rows[0].keywords_json,
        segments_json=json.dumps(merged_segments, ensure_ascii=False),
        warnings_json=json.dumps([*warnings, "Candidato unido por el editor."], ensure_ascii=False),
        removed_context_warning=None,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


def replace_candidate(
    db: Session,
    project_id: UUID,
    candidate_id: UUID,
    instruction: str,
) -> AnalysisCandidate:
    """Ask the AI for a different clip and overwrite the pending candidate."""
    from app.core.config import get_settings
    from app.models.project import Project
    from app.services.ai import resolve_provider
    from app.services.ai.schemas import AnalysisPreferences, AnalysisRequest, SermonMetadata
    from app.services.ai.transcript import transcript_to_ai_inputs
    from app.services.analysis.validate import validate_analysis_response
    from app.services.transcripts import service as transcripts_service

    candidate = get_candidate(db, project_id, candidate_id)
    if candidate.status != AnalysisCandidateStatus.pending:
        raise ConflictError(
            "Solo se reemplazan candidatos pendientes.",
            code="replace_not_pending",
        )
    project = db.get(Project, project_id)
    if project is None:
        raise NotFoundError("Project not found.", code="project_not_found")
    transcript = transcripts_service.get_transcript_for_project(db, project_id)
    segments = transcript_to_ai_inputs(transcript)
    video_duration = float(project.duration_seconds or segments[-1].end)
    settings = get_settings()
    job = get_job(db, candidate.job_id)
    avoided = ", ".join(
        f"{float(item.get('start', 0)):.1f}–{float(item.get('end', 0)):.1f}s"
        for item in _parse_json_list(candidate.segments_json)
        if isinstance(item, dict)
    )
    extra = (
        f"Sustituye este candidato por OTRO distinto. No reutilices estos intervalos: {avoided}. "
        f"Pedido del editor: {instruction.strip()}"
    )
    previous = (job.additional_instructions or "").strip()
    combined = f"{previous}\n{extra}".strip() if previous else extra
    preferences = AnalysisPreferences(
        max_reels=1,
        min_duration_seconds=job.min_duration_seconds,
        max_duration_seconds=job.max_duration_seconds,
        max_segments_per_reel=settings.ai_max_segments_per_reel,
        min_segment_seconds=settings.ai_min_segment_seconds,
        additional_instructions=combined[:2000],
        doctrinal_orientation=job.doctrinal_orientation
        or "cristiano reformado: centralidad de Cristo, gracia, fe, santidad",
    )
    request = AnalysisRequest(
        metadata=SermonMetadata(
            title=project.title,
            preacher_name=project.preacher_name,
            bible_reference=project.bible_reference,
            church_name=project.church_name,
            youtube_channel=project.youtube_channel,
            duration_seconds=video_duration,
        ),
        segments=segments,
        preferences=preferences,
    )
    result = resolve_provider().analyze(request)
    report = validate_analysis_response(
        result.response,
        segments=segments,
        video_duration=video_duration,
        min_segment_seconds=max(settings.min_reel_segment_seconds, preferences.min_segment_seconds),
        max_segments_per_clip=preferences.max_segments_per_reel,
        merge_gap_seconds=settings.ai_merge_gap_seconds,
        min_clip_seconds=preferences.min_duration_seconds,
        max_clip_seconds=preferences.max_duration_seconds
        + max(0.0, settings.ai_duration_slack_seconds),
    )
    if not report.accepted:
        raise ValidationAppError(
            "La IA no encontró un recambio válido. Prueba con otra instrucción.",
            code="replace_empty",
        )
    _apply_clip_to_candidate(candidate, report.accepted[0])
    db.commit()
    db.refresh(candidate)
    return candidate
