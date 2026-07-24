"""API routers.

Aggregates every router under a single ``api_router`` mounted with the
configured prefix (default ``/api``).
"""

from __future__ import annotations

from fastapi import APIRouter

from app.api.end_card import router as end_card_router
from app.api.health import router as health_router
from app.api.projects import router as projects_router
from app.api.reels import router as reels_router
from app.api.renders import router as renders_router
from app.api.subtitles import router as subtitles_router
from app.api.transcription import router as transcription_router
from app.api.transcripts import router as transcripts_router

api_router = APIRouter()
api_router.include_router(health_router)
api_router.include_router(projects_router)
api_router.include_router(transcripts_router)
api_router.include_router(transcription_router)
api_router.include_router(reels_router)
api_router.include_router(renders_router)
api_router.include_router(subtitles_router)
api_router.include_router(end_card_router)

__all__ = ["api_router"]
