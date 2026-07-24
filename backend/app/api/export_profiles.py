"""API for editable export profiles and size estimates."""

from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.schemas.export_profile import (
    ExportProfileListResponse,
    ExportProfileResponse,
    ExportProfileUpdate,
    SizeEstimateRequest,
    SizeEstimateResponse,
)
from app.services.export_profiles import service as profiles_service

router = APIRouter(tags=["export-profiles"])


@router.get("/export-profiles", response_model=ExportProfileListResponse)
def list_export_profiles(db: Session = Depends(get_db)) -> ExportProfileListResponse:
    items = profiles_service.list_profiles(db)
    return ExportProfileListResponse(
        items=[ExportProfileResponse.model_validate(row) for row in items],
        total=len(items),
    )


@router.get("/export-profiles/{profile_id}", response_model=ExportProfileResponse)
def get_export_profile(
    profile_id: UUID,
    db: Session = Depends(get_db),
) -> ExportProfileResponse:
    return ExportProfileResponse.model_validate(profiles_service.get_profile(db, profile_id))


@router.put("/export-profiles/{profile_id}", response_model=ExportProfileResponse)
def update_export_profile(
    profile_id: UUID,
    payload: ExportProfileUpdate,
    db: Session = Depends(get_db),
) -> ExportProfileResponse:
    row = profiles_service.update_profile(db, profile_id, payload)
    return ExportProfileResponse.model_validate(row)


@router.post(
    "/projects/{project_id}/reels/{reel_id}/export-estimate",
    response_model=SizeEstimateResponse,
)
def estimate_export_size(
    project_id: UUID,
    reel_id: UUID,
    payload: SizeEstimateRequest,
    db: Session = Depends(get_db),
) -> SizeEstimateResponse:
    estimate = profiles_service.estimate_for_reel(
        db,
        project_id,
        reel_id,
        profile_id=payload.profile_id,
        quality=payload.quality,
        crf=payload.crf,
    )
    profile = profiles_service.get_profile(db, payload.profile_id)
    note = profiles_service.fragmentation_note(profile, estimate.duration_seconds)
    return SizeEstimateResponse(
        duration_seconds=estimate.duration_seconds,
        width=estimate.width,
        height=estimate.height,
        fps=estimate.fps,
        crf=estimate.crf,
        audio_bitrate_k=estimate.audio_bitrate_k,
        estimated_bytes=estimate.estimated_bytes,
        estimated_mb=estimate.estimated_mb,
        note=estimate.note,
        fragmentation_note=note,
    )
