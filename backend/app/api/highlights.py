"""Video Highlights detection, analysis, review, metadata and export routes."""

from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends
from fastapi.responses import FileResponse, PlainTextResponse
from sqlalchemy.orm import Session

from app.core.exceptions import NotFoundError, ValidationAppError
from app.db.session import get_db
from app.models.export_profile import ExportQuality
from app.models.highlight import SubtitleDelivery
from app.models.reel import Reel
from app.schemas.highlight import (
    ContentMetadataUpdate,
    HighlightAnalysisJobResponse,
    HighlightAnalyzeRequest,
    HighlightExportRequest,
    HighlightPlanResponse,
    HighlightPreviewRequest,
    HighlightPreviewResponse,
    HighlightRenderResponse,
    HighlightReviewUpdate,
    SermonRangeUpdate,
)
from app.services import projects as projects_service
from app.services.export_profiles.service import default_highlight_profile
from app.services.highlights import service
from app.services.highlights.manager import (
    HighlightAnalysisManager,
    get_highlight_analysis_manager,
    job_to_response,
)
from app.services.highlights.preview import (
    clip_identity,
    current_preview_path,
    ensure_highlights_preview,
)
from app.services.render.manager import RenderManager, get_render_manager
from app.services.subtitles.srt import render_srt_for_reel
from app.services.transcripts import service as transcripts_service

router = APIRouter(tags=["video-highlights"])


@router.get("/projects/{project_id}/highlights", response_model=HighlightPlanResponse)
def get_highlight_plan(
    project_id: UUID,
    db: Session = Depends(get_db),
) -> HighlightPlanResponse:
    return service.to_response(db, service.get_or_create_plan(db, project_id))


@router.post(
    "/projects/{project_id}/highlights/detect",
    response_model=HighlightPlanResponse,
)
def detect_sermon(
    project_id: UUID,
    db: Session = Depends(get_db),
) -> HighlightPlanResponse:
    return service.to_response(db, service.detect(db, project_id))


@router.patch(
    "/projects/{project_id}/highlights/sermon-range",
    response_model=HighlightPlanResponse,
)
def set_sermon_range(
    project_id: UUID,
    payload: SermonRangeUpdate,
    db: Session = Depends(get_db),
) -> HighlightPlanResponse:
    return service.to_response(db, service.update_sermon_range(db, project_id, payload))


@router.post(
    "/projects/{project_id}/highlights/analyze",
    response_model=HighlightAnalysisJobResponse,
    status_code=202,
)
def start_highlight_analysis(
    project_id: UUID,
    payload: HighlightAnalyzeRequest,
    db: Session = Depends(get_db),
    manager: HighlightAnalysisManager = Depends(get_highlight_analysis_manager),
) -> HighlightAnalysisJobResponse:
    job = manager.start(
        db,
        project_id,
        target_duration_seconds=payload.target_duration_seconds,
        editorial_style=payload.editorial_style,
    )
    return job_to_response(db, manager.get(db, job.id), include_plan=False)


@router.get(
    "/projects/{project_id}/highlights/analysis",
    response_model=HighlightAnalysisJobResponse,
)
def get_latest_highlight_analysis(
    project_id: UUID,
    db: Session = Depends(get_db),
    manager: HighlightAnalysisManager = Depends(get_highlight_analysis_manager),
) -> HighlightAnalysisJobResponse:
    job = manager.latest(db, project_id)
    if job is None:
        raise NotFoundError(
            "Todavía no existe un análisis de Highlights.",
            code="highlight_analysis_job_not_found",
        )
    return job_to_response(db, job)


@router.get(
    "/highlight-analysis-jobs/{job_id}",
    response_model=HighlightAnalysisJobResponse,
)
def get_highlight_analysis_job(
    job_id: UUID,
    db: Session = Depends(get_db),
    manager: HighlightAnalysisManager = Depends(get_highlight_analysis_manager),
) -> HighlightAnalysisJobResponse:
    return job_to_response(db, manager.get(db, job_id))


@router.post(
    "/highlight-analysis-jobs/{job_id}/cancel",
    response_model=HighlightAnalysisJobResponse,
)
def cancel_highlight_analysis_job(
    job_id: UUID,
    db: Session = Depends(get_db),
    manager: HighlightAnalysisManager = Depends(get_highlight_analysis_manager),
) -> HighlightAnalysisJobResponse:
    return job_to_response(db, manager.cancel(db, job_id), include_plan=False)


@router.put(
    "/projects/{project_id}/highlights/review",
    response_model=HighlightPlanResponse,
)
def update_highlight_review(
    project_id: UUID,
    payload: HighlightReviewUpdate,
    db: Session = Depends(get_db),
) -> HighlightPlanResponse:
    return service.to_response(db, service.update_review(db, project_id, payload))


@router.patch(
    "/projects/{project_id}/highlights/metadata",
    response_model=HighlightPlanResponse,
)
def update_highlight_metadata(
    project_id: UUID,
    payload: ContentMetadataUpdate,
    db: Session = Depends(get_db),
) -> HighlightPlanResponse:
    return service.to_response(db, service.update_metadata(db, project_id, payload))


@router.post(
    "/projects/{project_id}/highlights/preview",
    response_model=HighlightPreviewResponse,
)
def prepare_highlight_preview(
    project_id: UUID,
    payload: HighlightPreviewRequest,
    db: Session = Depends(get_db),
) -> HighlightPreviewResponse:
    project = projects_service.get_project(db, project_id)
    if not project.video_filename:
        raise NotFoundError("Project has no video.", code="video_not_found")
    video_filename = project.video_filename
    clips = [(item.start, item.end) for item in payload.clips]
    db.close()
    ensure_highlights_preview(project_id, video_filename, clips)
    return HighlightPreviewResponse(ready=True, identity=clip_identity(clips))


@router.get("/projects/{project_id}/highlights/preview")
def get_highlight_preview(project_id: UUID) -> FileResponse:
    path = current_preview_path(project_id)
    return FileResponse(
        path,
        media_type="video/mp4",
        filename="highlights-preview.mp4",
        content_disposition_type="inline",
        headers={"Cache-Control": "private, max-age=0, must-revalidate"},
    )


@router.get("/projects/{project_id}/highlights/subtitles.srt")
def get_highlight_srt(
    project_id: UUID,
    db: Session = Depends(get_db),
) -> PlainTextResponse:
    plan = service.get_plan(db, project_id)
    if plan.reel_id is None:
        raise ValidationAppError(
            "No hay fragmentos para generar subtítulos.",
            code="highlight_selection_missing",
        )
    reel = db.get(Reel, plan.reel_id)
    if reel is None:
        raise NotFoundError("Edición de Highlights no encontrada.", code="reel_not_found")
    try:
        transcript = transcripts_service.get_transcript_for_project(db, project_id)
    except NotFoundError:
        transcript = None
    body = render_srt_for_reel(reel, transcript)
    return PlainTextResponse(
        body,
        media_type="application/x-subrip",
        headers={"Content-Disposition": 'attachment; filename="video-highlights.srt"'},
    )


@router.post(
    "/projects/{project_id}/highlights/render",
    response_model=HighlightRenderResponse,
    status_code=202,
)
def render_highlight(
    project_id: UUID,
    payload: HighlightExportRequest,
    db: Session = Depends(get_db),
    manager: RenderManager = Depends(get_render_manager),
) -> HighlightRenderResponse:
    plan = service.get_plan(db, project_id)
    if plan.reel_id is None:
        raise ValidationAppError(
            "Revise y confirme los fragmentos antes de renderizar.",
            code="highlight_selection_missing",
        )
    reel = db.get(Reel, plan.reel_id)
    if reel is None:
        raise NotFoundError("Edición de Highlights no encontrada.", code="reel_not_found")
    plan.subtitle_delivery = payload.subtitle_delivery
    reel.subtitle_enabled = payload.subtitle_delivery != SubtitleDelivery.none
    db.commit()
    profile = default_highlight_profile(db)
    job = manager.start(
        db,
        project_id,
        reel.id,
        aspect_ratio="16:9",
        layout="center_crop",
        normalize_loudness=payload.normalize_loudness,
        crf=payload.crf,
        burn_subtitles=payload.subtitle_delivery
        in {SubtitleDelivery.burned, SubtitleDelivery.both},
        profile_id=profile.id,
        quality=ExportQuality(payload.quality),
    )
    srt_url = (
        f"/api/projects/{project_id}/highlights/subtitles.srt"
        if payload.subtitle_delivery in {SubtitleDelivery.srt, SubtitleDelivery.both}
        else None
    )
    return HighlightRenderResponse(render_job_id=job.id, srt_url=srt_url)
