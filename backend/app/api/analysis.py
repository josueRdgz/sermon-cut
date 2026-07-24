"""Endpoints for optional AI analysis of transcripts into Reel candidates."""

from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.models.reel import AspectRatio
from app.schemas.analysis import (
    AnalysisAcceptResponse,
    AnalysisCandidateListResponse,
    AnalysisCandidateResponse,
    AnalysisJobResponse,
    AnalysisProviderStatusResponse,
    AnalysisStartRequest,
)
from app.services import projects as projects_service
from app.services.ai import provider_availability
from app.services.analysis import service as analysis_service
from app.services.analysis.manager import AnalysisManager, get_analysis_manager

router = APIRouter(tags=["analysis"])


@router.get("/analysis/provider", response_model=AnalysisProviderStatusResponse)
def get_analysis_provider_status() -> AnalysisProviderStatusResponse:
    """Report whether Gemini is configured. The feature remains optional."""
    return AnalysisProviderStatusResponse(**provider_availability())


@router.post(
    "/projects/{project_id}/analysis",
    response_model=AnalysisJobResponse,
    status_code=202,
)
def start_analysis(
    project_id: UUID,
    payload: AnalysisStartRequest,
    db: Session = Depends(get_db),
    manager: AnalysisManager = Depends(get_analysis_manager),
) -> AnalysisJobResponse:
    """Start an optional AI analysis. Does not render anything automatically."""
    job = manager.start(
        db,
        project_id,
        max_reels=payload.max_reels,
        min_duration_seconds=payload.min_duration_seconds,
        max_duration_seconds=payload.max_duration_seconds,
        additional_instructions=payload.additional_instructions,
        doctrinal_orientation=payload.doctrinal_orientation,
    )
    return analysis_service.job_to_response(manager.get(db, job.id))


@router.get(
    "/projects/{project_id}/analysis",
    response_model=AnalysisJobResponse,
)
def get_latest_analysis(
    project_id: UUID,
    db: Session = Depends(get_db),
    manager: AnalysisManager = Depends(get_analysis_manager),
) -> AnalysisJobResponse:
    from app.core.exceptions import NotFoundError

    job = manager.get_latest_for_project(db, project_id)
    if job is None:
        raise NotFoundError("No analysis job found.", code="analysis_job_not_found")
    return analysis_service.job_to_response(job)


@router.get("/analysis-jobs/{job_id}", response_model=AnalysisJobResponse)
def get_analysis_job(
    job_id: UUID,
    db: Session = Depends(get_db),
    manager: AnalysisManager = Depends(get_analysis_manager),
) -> AnalysisJobResponse:
    return analysis_service.job_to_response(manager.get(db, job_id))


@router.post("/analysis-jobs/{job_id}/cancel", response_model=AnalysisJobResponse)
def cancel_analysis_job(
    job_id: UUID,
    db: Session = Depends(get_db),
    manager: AnalysisManager = Depends(get_analysis_manager),
) -> AnalysisJobResponse:
    job = manager.cancel(db, job_id)
    return analysis_service.job_to_response(manager.get(db, job.id))


@router.get(
    "/projects/{project_id}/analysis/candidates",
    response_model=AnalysisCandidateListResponse,
)
def list_analysis_candidates(
    project_id: UUID,
    job_id: UUID | None = Query(default=None),
    db: Session = Depends(get_db),
) -> AnalysisCandidateListResponse:
    projects_service.get_project(db, project_id)
    items = analysis_service.list_candidates(db, project_id, job_id=job_id)
    responses = [analysis_service.candidate_to_response(item) for item in items]
    return AnalysisCandidateListResponse(items=responses, total=len(responses))


@router.post(
    "/projects/{project_id}/analysis/candidates/{candidate_id}/accept",
    response_model=AnalysisAcceptResponse,
)
def accept_analysis_candidate(
    project_id: UUID,
    candidate_id: UUID,
    aspect_ratio: AspectRatio = Query(default=AspectRatio.nine_sixteen),
    db: Session = Depends(get_db),
) -> AnalysisAcceptResponse:
    """Approve a candidate: creates a Reel. Never starts a render."""
    candidate, reel_id = analysis_service.accept_candidate(
        db, project_id, candidate_id, aspect_ratio=aspect_ratio
    )
    return AnalysisAcceptResponse(
        candidate=analysis_service.candidate_to_response(candidate),
        reel_id=reel_id,
    )


@router.post(
    "/projects/{project_id}/analysis/candidates/{candidate_id}/reject",
    response_model=AnalysisCandidateResponse,
)
def reject_analysis_candidate(
    project_id: UUID,
    candidate_id: UUID,
    db: Session = Depends(get_db),
) -> AnalysisCandidateResponse:
    candidate = analysis_service.reject_candidate(db, project_id, candidate_id)
    return analysis_service.candidate_to_response(candidate)
