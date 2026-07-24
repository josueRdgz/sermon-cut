"""API for optional technical cut suggestions (never auto-applied)."""

from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.schemas.cut_suggestions import (
    CutSuggestRequest,
    CutSuggestionActionResponse,
    CutSuggestionsReport,
)
from app.services.cut_suggestions import service as cut_service

router = APIRouter(tags=["cut-suggestions"])


@router.post(
    "/projects/{project_id}/reels/{reel_id}/cut-suggestions",
    response_model=CutSuggestionsReport,
)
def generate_cut_suggestions(
    project_id: UUID,
    reel_id: UUID,
    payload: CutSuggestRequest = CutSuggestRequest(),
    db: Session = Depends(get_db),
) -> CutSuggestionsReport:
    """Analyze silences / hesitations and return suggestions without mutating cuts."""
    return cut_service.generate_suggestions(db, project_id, reel_id, payload)


@router.get(
    "/projects/{project_id}/reels/{reel_id}/cut-suggestions",
    response_model=CutSuggestionsReport,
)
def get_cut_suggestions(
    project_id: UUID,
    reel_id: UUID,
    db: Session = Depends(get_db),
) -> CutSuggestionsReport:
    return cut_service.list_suggestions(db, project_id, reel_id)


@router.post(
    "/projects/{project_id}/reels/{reel_id}/cut-suggestions/{suggestion_id}/accept",
    response_model=CutSuggestionActionResponse,
)
def accept_cut_suggestion(
    project_id: UUID,
    reel_id: UUID,
    suggestion_id: UUID,
    db: Session = Depends(get_db),
) -> CutSuggestionActionResponse:
    """Apply one suggestion after explicit user approval."""
    return cut_service.accept_suggestion(db, project_id, reel_id, suggestion_id)


@router.post(
    "/projects/{project_id}/reels/{reel_id}/cut-suggestions/{suggestion_id}/reject",
    response_model=CutSuggestionActionResponse,
)
def reject_cut_suggestion(
    project_id: UUID,
    reel_id: UUID,
    suggestion_id: UUID,
    db: Session = Depends(get_db),
) -> CutSuggestionActionResponse:
    return cut_service.reject_suggestion(db, project_id, reel_id, suggestion_id)
