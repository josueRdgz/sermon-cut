"""In-app runtime settings (Gemini, Whisper). Persists to the active .env file."""

from __future__ import annotations

from fastapi import APIRouter

from app.schemas.settings import AppSettingsResponse, AppSettingsUpdate
from app.services import app_settings as app_settings_service

router = APIRouter(tags=["settings"])


@router.get("/settings", response_model=AppSettingsResponse)
def get_app_settings() -> AppSettingsResponse:
    return app_settings_service.to_response()


@router.put("/settings", response_model=AppSettingsResponse)
def update_app_settings(payload: AppSettingsUpdate) -> AppSettingsResponse:
    return app_settings_service.update_settings(payload)
