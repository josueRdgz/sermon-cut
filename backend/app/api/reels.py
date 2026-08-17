"""CRUD endpoints for Reels and their non-consecutive segments."""

from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.schemas.coherence import (
    CoherenceAutoFixRequest,
    CoherenceAutoFixResponse,
    CoherenceDismissRequest,
    CoherenceExpandContextRequest,
    CoherenceReport,
    CoherenceValidateRequest,
)
from app.schemas.reel import (
    ReelCreate,
    ReelFromTranscriptRequest,
    ReelListResponse,
    ReelResponse,
    ReelSegmentCreate,
    ReelSegmentReorderRequest,
    ReelSegmentUpdate,
    ReelUpdate,
)
from app.services.coherence import service as coherence_service
from app.services.reel_preview import (
    current_reel_preview_path,
    ensure_reel_assembled_preview,
)
from app.services.reels import service as reels_service

router = APIRouter(tags=["reels"])


@router.get("/projects/{project_id}/reels", response_model=ReelListResponse)
def list_reels(project_id: UUID, db: Session = Depends(get_db)) -> ReelListResponse:
    reels = reels_service.list_reels(db, project_id)
    items = [reels_service.to_response(r) for r in reels]
    return ReelListResponse(items=items, total=len(items))


@router.post(
    "/projects/{project_id}/reels",
    response_model=ReelResponse,
    status_code=201,
)
def create_reel(
    project_id: UUID,
    payload: ReelCreate,
    db: Session = Depends(get_db),
) -> ReelResponse:
    reel = reels_service.create_reel(db, project_id, payload)
    return reels_service.to_response(reel)


@router.post(
    "/projects/{project_id}/reels/from-transcript",
    response_model=ReelResponse,
    status_code=201,
)
def create_reel_from_transcript(
    project_id: UUID,
    payload: ReelFromTranscriptRequest,
    db: Session = Depends(get_db),
) -> ReelResponse:
    """Create a Reel (or append to one) from selected transcript segments."""
    reel = reels_service.create_or_append_from_transcript(db, project_id, payload)
    return reels_service.to_response(reel)


@router.get("/projects/{project_id}/reels/{reel_id}", response_model=ReelResponse)
def get_reel(
    project_id: UUID,
    reel_id: UUID,
    db: Session = Depends(get_db),
) -> ReelResponse:
    reel = reels_service.get_reel_for_project(db, project_id, reel_id)
    return reels_service.to_response(reel)


@router.patch("/projects/{project_id}/reels/{reel_id}", response_model=ReelResponse)
def update_reel(
    project_id: UUID,
    reel_id: UUID,
    payload: ReelUpdate,
    db: Session = Depends(get_db),
) -> ReelResponse:
    reel = reels_service.update_reel(db, project_id, reel_id, payload)
    return reels_service.to_response(reel)


@router.delete("/projects/{project_id}/reels/{reel_id}", status_code=204)
def delete_reel(project_id: UUID, reel_id: UUID, db: Session = Depends(get_db)) -> None:
    reels_service.delete_reel(db, project_id, reel_id)


@router.post(
    "/projects/{project_id}/reels/{reel_id}/segments",
    response_model=ReelResponse,
    status_code=201,
)
def add_segment(
    project_id: UUID,
    reel_id: UUID,
    payload: ReelSegmentCreate,
    db: Session = Depends(get_db),
) -> ReelResponse:
    reel = reels_service.add_segment(db, project_id, reel_id, payload)
    return reels_service.to_response(reel)


@router.patch(
    "/projects/{project_id}/reels/{reel_id}/segments/{segment_id}",
    response_model=ReelResponse,
)
def update_segment(
    project_id: UUID,
    reel_id: UUID,
    segment_id: UUID,
    payload: ReelSegmentUpdate,
    db: Session = Depends(get_db),
) -> ReelResponse:
    reel = reels_service.update_segment(db, project_id, reel_id, segment_id, payload)
    return reels_service.to_response(reel)


@router.delete(
    "/projects/{project_id}/reels/{reel_id}/segments/{segment_id}",
    response_model=ReelResponse,
)
def delete_segment(
    project_id: UUID,
    reel_id: UUID,
    segment_id: UUID,
    db: Session = Depends(get_db),
) -> ReelResponse:
    reel = reels_service.delete_segment(db, project_id, reel_id, segment_id)
    return reels_service.to_response(reel)


@router.put(
    "/projects/{project_id}/reels/{reel_id}/segments/order",
    response_model=ReelResponse,
)
def reorder_segments(
    project_id: UUID,
    reel_id: UUID,
    payload: ReelSegmentReorderRequest,
    db: Session = Depends(get_db),
) -> ReelResponse:
    reel = reels_service.reorder_segments(db, project_id, reel_id, payload)
    return reels_service.to_response(reel)


@router.post(
    "/projects/{project_id}/reels/{reel_id}/validate",
    response_model=CoherenceReport,
)
def validate_reel_coherence(
    project_id: UUID,
    reel_id: UUID,
    payload: CoherenceValidateRequest = CoherenceValidateRequest(),
    db: Session = Depends(get_db),
) -> CoherenceReport:
    """Detect incoherent or misleading joins before the final render."""
    return coherence_service.validate_reel(db, project_id, reel_id, payload)


@router.post(
    "/projects/{project_id}/reels/{reel_id}/validate/dismiss",
    response_model=CoherenceReport,
)
def dismiss_coherence_warning(
    project_id: UUID,
    reel_id: UUID,
    payload: CoherenceDismissRequest,
    db: Session = Depends(get_db),
) -> CoherenceReport:
    """Ignore a non-blocking coherence warning for this Reel."""
    return coherence_service.dismiss_warning(db, project_id, reel_id, payload)


@router.post(
    "/projects/{project_id}/reels/{reel_id}/validate/expand-context",
    response_model=ReelResponse,
)
def expand_coherence_context(
    project_id: UUID,
    reel_id: UUID,
    payload: CoherenceExpandContextRequest,
    db: Session = Depends(get_db),
) -> ReelResponse:
    """Widen a fragment by neighbouring seconds to restore cut context."""
    reel = coherence_service.expand_segment_context(db, project_id, reel_id, payload)
    return reels_service.to_response(reel)


@router.post(
    "/projects/{project_id}/reels/{reel_id}/validate/auto-fix",
    response_model=CoherenceAutoFixResponse,
)
def auto_fix_coherence(
    project_id: UUID,
    reel_id: UUID,
    payload: CoherenceAutoFixRequest = CoherenceAutoFixRequest(),
    db: Session = Depends(get_db),
) -> CoherenceAutoFixResponse:
    """Repair safe timing/context/transition findings and validate again."""
    reel, report, fixes = coherence_service.auto_fix_reel(db, project_id, reel_id, payload)
    remaining = sum(1 for issue in report.issues if not issue.dismissed)
    return CoherenceAutoFixResponse(
        reel=reels_service.to_response(reel),
        report=report,
        fixes=fixes,
        remaining_issues=remaining,
    )


@router.post("/projects/{project_id}/reels/{reel_id}/assembled-preview")
def prepare_assembled_preview(
    project_id: UUID,
    reel_id: UUID,
    db: Session = Depends(get_db),
) -> dict[str, bool | str]:
    """Build (or reuse) an assembled MP4 that includes transitions and overlays."""
    path = ensure_reel_assembled_preview(db, project_id, reel_id)
    return {"ready": True, "filename": path.name}


@router.get("/projects/{project_id}/reels/{reel_id}/assembled-preview")
def get_assembled_preview(project_id: UUID, reel_id: UUID) -> FileResponse:
    path = current_reel_preview_path(project_id)
    return FileResponse(
        path,
        media_type="video/mp4",
        filename="reel-assembled-preview.mp4",
        content_disposition_type="inline",
        headers={"Cache-Control": "private, max-age=0, must-revalidate"},
    )
