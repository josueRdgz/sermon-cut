"""CRUD for reel overlays on the output clock."""

from __future__ import annotations

from datetime import UTC, datetime
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.exceptions import NotFoundError, ValidationAppError
from app.models.project_asset import ProjectAsset, ProjectAssetKind
from app.models.reel import Reel
from app.models.reel_overlay import ReelOverlay, ReelOverlayKind
from app.schemas.overlay import (
    ReelOverlayCreate,
    ReelOverlayListResponse,
    ReelOverlayResponse,
    ReelOverlayUpdate,
)
from app.services import projects as projects_service
from app.services.assets import media_url
from app.services.reels import service as reels_service


def _touch(overlay: ReelOverlay) -> None:
    overlay.updated_at = datetime.now(UTC)


def to_response(overlay: ReelOverlay, *, project_id: UUID | None = None) -> ReelOverlayResponse:
    asset_url = None
    if overlay.asset_id is not None and project_id is not None:
        asset_url = media_url(project_id, overlay.asset_id)
    return ReelOverlayResponse(
        id=overlay.id,
        reel_id=overlay.reel_id,
        kind=overlay.kind,
        asset_id=overlay.asset_id,
        text=overlay.text,
        style_json=overlay.style_json,
        start_ms=overlay.start_ms,
        duration_ms=overlay.duration_ms,
        x=overlay.x,
        y=overlay.y,
        scale=overlay.scale,
        opacity=overlay.opacity,
        z_index=overlay.z_index,
        order=overlay.order,
        created_at=overlay.created_at,
        updated_at=overlay.updated_at,
        asset_media_url=asset_url,
    )


def _get_reel(db: Session, project_id: UUID, reel_id: UUID) -> Reel:
    return reels_service.get_reel_for_project(db, project_id, reel_id)


def list_overlays(db: Session, project_id: UUID, reel_id: UUID) -> ReelOverlayListResponse:
    reel = _get_reel(db, project_id, reel_id)
    rows = list(
        db.scalars(
            select(ReelOverlay)
            .where(ReelOverlay.reel_id == reel.id)
            .order_by(ReelOverlay.z_index.asc(), ReelOverlay.order.asc(), ReelOverlay.start_ms.asc())
        )
    )
    return ReelOverlayListResponse(
        items=[to_response(row, project_id=project_id) for row in rows],
        total=len(rows),
    )


def get_overlay(db: Session, project_id: UUID, reel_id: UUID, overlay_id: UUID) -> ReelOverlay:
    _get_reel(db, project_id, reel_id)
    overlay = db.get(ReelOverlay, overlay_id)
    if overlay is None or overlay.reel_id != reel_id:
        raise NotFoundError("Overlay not found.", code="overlay_not_found")
    return overlay


def _validate_create(db: Session, project_id: UUID, payload: ReelOverlayCreate) -> None:
    if payload.kind == ReelOverlayKind.image:
        if payload.asset_id is None:
            raise ValidationAppError(
                "Image overlays require an asset_id.",
                code="overlay_asset_required",
            )
        asset = db.get(ProjectAsset, payload.asset_id)
        if asset is None or asset.project_id != project_id:
            raise NotFoundError("Asset not found.", code="asset_not_found")
        if asset.kind != ProjectAssetKind.image:
            raise ValidationAppError(
                "Only image assets can be used as overlays.",
                code="overlay_asset_kind",
            )
    elif payload.kind == ReelOverlayKind.text:
        if not (payload.text or "").strip():
            raise ValidationAppError(
                "Text overlays require non-empty text.",
                code="overlay_text_required",
            )


def create_overlay(
    db: Session,
    project_id: UUID,
    reel_id: UUID,
    payload: ReelOverlayCreate,
) -> ReelOverlay:
    reel = _get_reel(db, project_id, reel_id)
    _validate_create(db, project_id, payload)
    order = payload.order
    if order is None:
        existing = list(db.scalars(select(ReelOverlay).where(ReelOverlay.reel_id == reel.id)))
        order = len(existing)

    overlay = ReelOverlay(
        reel_id=reel.id,
        kind=payload.kind,
        asset_id=payload.asset_id if payload.kind == ReelOverlayKind.image else None,
        text=(payload.text or "").strip() if payload.kind == ReelOverlayKind.text else None,
        style_json=payload.style_json,
        start_ms=payload.start_ms,
        duration_ms=payload.duration_ms,
        x=payload.x,
        y=payload.y,
        scale=payload.scale,
        opacity=payload.opacity,
        z_index=payload.z_index,
        order=order,
    )
    db.add(overlay)
    reels_service._touch(reel)  # noqa: SLF001 — shared updated_at
    db.commit()
    db.refresh(overlay)
    return overlay


def update_overlay(
    db: Session,
    project_id: UUID,
    reel_id: UUID,
    overlay_id: UUID,
    payload: ReelOverlayUpdate,
) -> ReelOverlay:
    reel = _get_reel(db, project_id, reel_id)
    overlay = get_overlay(db, project_id, reel_id, overlay_id)
    data = payload.model_dump(exclude_unset=True)

    if "asset_id" in data and data["asset_id"] is not None:
        asset = db.get(ProjectAsset, data["asset_id"])
        if asset is None or asset.project_id != project_id:
            raise NotFoundError("Asset not found.", code="asset_not_found")
        if asset.kind != ProjectAssetKind.image:
            raise ValidationAppError(
                "Only image assets can be used as overlays.",
                code="overlay_asset_kind",
            )

    if "text" in data and overlay.kind == ReelOverlayKind.text:
        text = (data["text"] or "").strip()
        if not text:
            raise ValidationAppError(
                "Text overlays require non-empty text.",
                code="overlay_text_required",
            )
        data["text"] = text

    for key, value in data.items():
        setattr(overlay, key, value)
    _touch(overlay)
    reels_service._touch(reel)  # noqa: SLF001
    db.commit()
    db.refresh(overlay)
    return overlay


def delete_overlay(db: Session, project_id: UUID, reel_id: UUID, overlay_id: UUID) -> None:
    reel = _get_reel(db, project_id, reel_id)
    overlay = get_overlay(db, project_id, reel_id, overlay_id)
    db.delete(overlay)
    reels_service._touch(reel)  # noqa: SLF001
    db.commit()


def list_overlays_for_render(db: Session, reel_id: UUID) -> list[ReelOverlay]:
    return list(
        db.scalars(
            select(ReelOverlay)
            .where(ReelOverlay.reel_id == reel_id)
            .order_by(ReelOverlay.z_index.asc(), ReelOverlay.order.asc(), ReelOverlay.start_ms.asc())
        )
    )


def ensure_project(db: Session, project_id: UUID) -> None:
    projects_service.get_project(db, project_id)
