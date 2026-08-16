"""CRUD endpoints for reel overlays."""

from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.schemas.overlay import (
    ReelOverlayCreate,
    ReelOverlayListResponse,
    ReelOverlayResponse,
    ReelOverlayUpdate,
)
from app.services import overlays as overlays_service

router = APIRouter(tags=["overlays"])


@router.get(
    "/projects/{project_id}/reels/{reel_id}/overlays",
    response_model=ReelOverlayListResponse,
)
def list_overlays(
    project_id: UUID,
    reel_id: UUID,
    db: Session = Depends(get_db),
) -> ReelOverlayListResponse:
    items = overlays_service.list_overlays(db, project_id, reel_id)
    return ReelOverlayListResponse(
        items=[overlays_service.to_response(item, project_id=project_id) for item in items],
        total=len(items),
    )


@router.post(
    "/projects/{project_id}/reels/{reel_id}/overlays",
    response_model=ReelOverlayResponse,
    status_code=201,
)
def create_overlay(
    project_id: UUID,
    reel_id: UUID,
    payload: ReelOverlayCreate,
    db: Session = Depends(get_db),
) -> ReelOverlayResponse:
    overlay = overlays_service.create_overlay(db, project_id, reel_id, payload)
    return overlays_service.to_response(overlay, project_id=project_id)


@router.patch(
    "/projects/{project_id}/reels/{reel_id}/overlays/{overlay_id}",
    response_model=ReelOverlayResponse,
)
def update_overlay(
    project_id: UUID,
    reel_id: UUID,
    overlay_id: UUID,
    payload: ReelOverlayUpdate,
    db: Session = Depends(get_db),
) -> ReelOverlayResponse:
    overlay = overlays_service.update_overlay(db, project_id, reel_id, overlay_id, payload)
    return overlays_service.to_response(overlay, project_id=project_id)


@router.delete(
    "/projects/{project_id}/reels/{reel_id}/overlays/{overlay_id}",
    status_code=204,
)
def delete_overlay(
    project_id: UUID,
    reel_id: UUID,
    overlay_id: UUID,
    db: Session = Depends(get_db),
) -> None:
    overlays_service.delete_overlay(db, project_id, reel_id, overlay_id)
