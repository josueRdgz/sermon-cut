"""Endpoints for the mandatory end card: settings, assets and preview."""

from __future__ import annotations

import io
from collections.abc import AsyncIterator
from uuid import UUID

from fastapi import APIRouter, Depends, File, Query, UploadFile
from fastapi.responses import Response
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.models.end_card import EndCardLayout
from app.schemas.end_card import (
    EndCardLayoutInfo,
    EndCardLayoutListResponse,
    EndCardSettingsResponse,
    EndCardSettingsUpdate,
)
from app.services import projects as projects_service
from app.services.endcard import service as end_card_service
from app.services.endcard.image import render_end_card
from app.services.render.args import canvas_for

router = APIRouter(tags=["end-card"])

_LAYOUTS: tuple[EndCardLayoutInfo, ...] = (
    EndCardLayoutInfo(
        id=EndCardLayout.cover_full,
        label="Portada completa",
        description="La portada llena la pantalla con un oscurecimiento para legibilidad.",
        needs_cover=True,
    ),
    EndCardLayoutInfo(
        id=EndCardLayout.cover_card,
        label="Portada en tarjeta",
        description="La portada aparece dentro de una tarjeta con esquinas redondeadas.",
        needs_cover=True,
    ),
    EndCardLayoutInfo(
        id=EndCardLayout.minimal,
        label="Minimalista",
        description="Fondo limpio con logo y título; no necesita portada.",
        needs_cover=False,
    ),
)


async def _upload_chunks(upload: UploadFile) -> AsyncIterator[bytes]:
    while True:
        chunk = await upload.read(1024 * 1024)
        if not chunk:
            break
        yield chunk


def _response(config: end_card_service.ResolvedEndCard) -> EndCardSettingsResponse:
    return EndCardSettingsResponse(
        layout=config.layout,
        duration_seconds=config.duration_seconds,
        fade_in_ms=config.fade_in_ms,
        audio_fade_out_ms=config.audio_fade_out_ms,
        audio_mode=config.audio_mode,
        music_filename=config.music_filename,
        music_volume=config.music_volume,
        logo_filename=config.logo_filename,
        url_text=config.url_text,
        show_qr=config.show_qr,
        qr_url=config.qr_url,
        channel_handle=config.channel_handle,
        custom_message=config.custom_message,
        is_project_override=config.is_project_override,
    )


@router.get("/end-card/layouts", response_model=EndCardLayoutListResponse)
def list_end_card_layouts() -> EndCardLayoutListResponse:
    """List the available end card designs."""
    return EndCardLayoutListResponse(items=list(_LAYOUTS))


@router.get("/end-card/settings", response_model=EndCardSettingsResponse)
def get_global_end_card_settings(db: Session = Depends(get_db)) -> EndCardSettingsResponse:
    """Return the global end card defaults."""
    return _response(end_card_service.resolve_global(db))


@router.put("/end-card/settings", response_model=EndCardSettingsResponse)
def update_global_end_card_settings(
    payload: EndCardSettingsUpdate,
    db: Session = Depends(get_db),
) -> EndCardSettingsResponse:
    """Save the global end card defaults."""
    end_card_service.upsert(db, project_id=None, values=payload.model_dump(exclude_unset=True))
    return _response(end_card_service.resolve_global(db))


@router.get(
    "/projects/{project_id}/end-card/settings",
    response_model=EndCardSettingsResponse,
)
def get_project_end_card_settings(
    project_id: UUID,
    db: Session = Depends(get_db),
) -> EndCardSettingsResponse:
    """Return the effective configuration for a project (override or global)."""
    projects_service.get_project(db, project_id)
    return _response(end_card_service.resolve(db, project_id))


@router.put(
    "/projects/{project_id}/end-card/settings",
    response_model=EndCardSettingsResponse,
)
def update_project_end_card_settings(
    project_id: UUID,
    payload: EndCardSettingsUpdate,
    db: Session = Depends(get_db),
) -> EndCardSettingsResponse:
    """Save a per-project override for the end card."""
    projects_service.get_project(db, project_id)
    end_card_service.upsert(
        db, project_id=project_id, values=payload.model_dump(exclude_unset=True)
    )
    return _response(end_card_service.resolve(db, project_id))


@router.delete(
    "/projects/{project_id}/end-card/settings",
    response_model=EndCardSettingsResponse,
)
def reset_project_end_card_settings(
    project_id: UUID,
    db: Session = Depends(get_db),
) -> EndCardSettingsResponse:
    """Drop the project override so the global configuration applies again."""
    projects_service.get_project(db, project_id)
    end_card_service.reset_project_settings(db, project_id)
    return _response(end_card_service.resolve(db, project_id))


@router.post(
    "/projects/{project_id}/end-card/logo",
    response_model=EndCardSettingsResponse,
)
async def upload_end_card_logo(
    project_id: UUID,
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
) -> EndCardSettingsResponse:
    """Upload the optional logo (PNG, JPEG or WebP) for this project's end card."""
    projects_service.require_non_empty_upload(file.filename)
    await end_card_service.attach_logo(
        db,
        project_id,
        original_filename=file.filename,
        content_type=file.content_type,
        chunks=_upload_chunks(file),
    )
    return _response(end_card_service.resolve(db, project_id))


@router.post(
    "/projects/{project_id}/end-card/music",
    response_model=EndCardSettingsResponse,
)
async def upload_end_card_music(
    project_id: UUID,
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
) -> EndCardSettingsResponse:
    """Upload the user's own music file. Nothing is ever downloaded automatically."""
    projects_service.require_non_empty_upload(file.filename)
    await end_card_service.attach_music(
        db,
        project_id,
        original_filename=file.filename,
        content_type=file.content_type,
        chunks=_upload_chunks(file),
    )
    return _response(end_card_service.resolve(db, project_id))


@router.get("/projects/{project_id}/end-card/preview")
def preview_end_card(
    project_id: UUID,
    aspect_ratio: str = Query(default="9:16"),
    layout: EndCardLayout | None = None,
    scale: float = Query(default=0.5, ge=0.1, le=1.0),
    db: Session = Depends(get_db),
) -> Response:
    """Render the end card as a PNG preview, using the same Pillow code as the render."""
    project = projects_service.get_project(db, project_id)
    config = end_card_service.resolve(db, project_id)
    content = end_card_service.build_content(project, config)

    width, height = canvas_for(aspect_ratio)
    image = render_end_card(
        content=content,
        layout=layout or config.layout,
        width=width,
        height=height,
    )
    if scale < 1.0:
        image = image.resize((round(width * scale), round(height * scale)))

    buffer = io.BytesIO()
    image.convert("RGB").save(buffer, format="PNG")
    return Response(
        content=buffer.getvalue(),
        media_type="image/png",
        # Preview must reflect edits immediately.
        headers={"Cache-Control": "no-store"},
    )
