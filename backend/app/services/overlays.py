"""CRUD for reel overlays (image, text titles, B-roll video)."""

from __future__ import annotations

from pathlib import Path
from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.exceptions import NotFoundError, ValidationAppError
from app.models.asset import ProjectAsset, ProjectAssetKind, ReelOverlay, ReelOverlayKind
from app.schemas.overlay import ReelOverlayCreate, ReelOverlayResponse, ReelOverlayUpdate
from app.services.assets import media_url, resolve_asset_path
from app.services.overlays_render import render_title_card
from app.services.reels import service as reels_service

_DEFAULTS = {
    ReelOverlayKind.image: {"x": 0.5, "y": 0.35, "scale": 0.4},
    ReelOverlayKind.text: {"x": 0.5, "y": 0.22, "scale": 1.0},
    ReelOverlayKind.video: {"x": 0.78, "y": 0.22, "scale": 0.38},
}


def to_response(overlay: ReelOverlay, *, project_id: UUID) -> ReelOverlayResponse:
    asset_media = None
    if overlay.asset_id is not None:
        asset_media = media_url(project_id, overlay.asset_id)
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
        asset_media_url=asset_media,
    )


def list_overlays(db: Session, project_id: UUID, reel_id: UUID) -> list[ReelOverlay]:
    reels_service.get_reel_for_project(db, project_id, reel_id)
    return list(
        db.scalars(
            select(ReelOverlay)
            .where(ReelOverlay.reel_id == reel_id)
            .order_by(ReelOverlay.start_ms, ReelOverlay.order, ReelOverlay.created_at)
        ).all()
    )


def get_overlay(db: Session, project_id: UUID, reel_id: UUID, overlay_id: UUID) -> ReelOverlay:
    reels_service.get_reel_for_project(db, project_id, reel_id)
    overlay = db.get(ReelOverlay, overlay_id)
    if overlay is None or overlay.reel_id != reel_id:
        raise NotFoundError("Overlay not found.", code="overlay_not_found")
    return overlay


def _require_asset(
    db: Session,
    project_id: UUID,
    asset_id: UUID,
    *,
    expected: ProjectAssetKind,
) -> ProjectAsset:
    asset = db.get(ProjectAsset, asset_id)
    if asset is None or asset.project_id != project_id:
        raise NotFoundError("Asset not found.", code="asset_not_found")
    if asset.kind != expected:
        raise ValidationAppError(
            f"This overlay needs a {expected.value} asset.",
            code="asset_kind_mismatch",
        )
    return asset


def create_overlay(
    db: Session,
    project_id: UUID,
    reel_id: UUID,
    payload: ReelOverlayCreate,
) -> ReelOverlay:
    reels_service.get_reel_for_project(db, project_id, reel_id)
    defaults = _DEFAULTS[payload.kind]
    duration_ms = payload.duration_ms
    asset_id = payload.asset_id

    if payload.kind in {ReelOverlayKind.image, ReelOverlayKind.video}:
        if asset_id is None:
            raise ValidationAppError(
                "Image and video overlays need an asset from the media bin.",
                code="asset_required",
            )
        expected = (
            ProjectAssetKind.video
            if payload.kind == ReelOverlayKind.video
            else ProjectAssetKind.image
        )
        asset = _require_asset(db, project_id, asset_id, expected=expected)
        if (
            payload.kind == ReelOverlayKind.video
            and payload.duration_ms == 3000
            and asset.duration_ms
            and asset.duration_ms > 0
        ):
            duration_ms = min(asset.duration_ms, 600_000)
    elif payload.kind == ReelOverlayKind.text:
        asset_id = None
        if not (payload.text or "").strip():
            payload = payload.model_copy(update={"text": "Texto"})

    next_order = db.scalar(
        select(func.coalesce(func.max(ReelOverlay.order), -1)).where(ReelOverlay.reel_id == reel_id)
    )
    overlay = ReelOverlay(
        reel_id=reel_id,
        kind=payload.kind,
        asset_id=asset_id,
        text=payload.text,
        start_ms=payload.start_ms,
        duration_ms=duration_ms,
        x=defaults["x"] if payload.x is None else payload.x,
        y=defaults["y"] if payload.y is None else payload.y,
        scale=defaults["scale"] if payload.scale is None else payload.scale,
        opacity=1.0 if payload.opacity is None else payload.opacity,
        z_index=0 if payload.z_index is None else payload.z_index,
        order=(next_order if next_order is not None else -1) + 1,
    )
    db.add(overlay)
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
    overlay = get_overlay(db, project_id, reel_id, overlay_id)
    values = payload.model_dump(exclude_unset=True)
    if "asset_id" in values and values["asset_id"] is not None:
        expected = (
            ProjectAssetKind.video
            if overlay.kind == ReelOverlayKind.video
            else ProjectAssetKind.image
        )
        if overlay.kind == ReelOverlayKind.text:
            raise ValidationAppError(
                "Text overlays do not use a media asset.",
                code="asset_not_allowed",
            )
        _require_asset(db, project_id, values["asset_id"], expected=expected)
    for key, value in values.items():
        setattr(overlay, key, value)
    db.commit()
    db.refresh(overlay)
    return overlay


def delete_overlay(db: Session, project_id: UUID, reel_id: UUID, overlay_id: UUID) -> None:
    overlay = get_overlay(db, project_id, reel_id, overlay_id)
    db.delete(overlay)
    db.commit()


def specs_for_render(
    db: Session,
    project_id: UUID,
    reel_id: UUID,
    *,
    temp_dir: Path,
) -> list:
    """Resolve overlay files for FFmpeg. Missing assets are skipped."""
    from app.services.render.args import OverlaySpec

    rows = list_overlays(db, project_id, reel_id)
    rows.sort(key=lambda item: (item.z_index, item.order, item.start_ms))
    specs: list[OverlaySpec] = []
    for row in rows:
        kind = "image"
        if row.kind == ReelOverlayKind.text:
            temp_dir.mkdir(parents=True, exist_ok=True)
            path = temp_dir / f"overlay-{row.id}.png"
            render_title_card(row.text or "Texto", path)
        elif row.asset_id is None:
            continue
        else:
            asset = db.get(ProjectAsset, row.asset_id)
            if asset is None:
                continue
            path = resolve_asset_path(project_id, asset)
            if not path.is_file():
                continue
            if row.kind == ReelOverlayKind.video:
                kind = "video"
        specs.append(
            OverlaySpec(
                path=path,
                start_seconds=max(0, row.start_ms) / 1000.0,
                duration_seconds=max(100, row.duration_ms) / 1000.0,
                x=row.x,
                y=row.y,
                scale=row.scale,
                opacity=row.opacity,
                kind=kind,
            )
        )
    return specs
