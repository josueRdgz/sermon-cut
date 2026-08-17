"""API routers.

Aggregates every router under a single ``api_router`` mounted with the
configured prefix (default ``/api``).
"""

from __future__ import annotations

from fastapi import APIRouter

from app.api.analysis import router as analysis_router
from app.api.assets import router as assets_router
from app.api.audio_repair import router as audio_repair_router
from app.api.background_music import router as background_music_router
from app.api.cut_suggestions import router as cut_suggestions_router
from app.api.end_card import router as end_card_router
from app.api.export_profiles import router as export_profiles_router
from app.api.framing import router as framing_router
from app.api.health import router as health_router
from app.api.highlights import router as highlights_router
from app.api.overlays import router as overlays_router
from app.api.projects import router as projects_router
from app.api.reels import router as reels_router
from app.api.renders import router as renders_router
from app.api.subtitles import router as subtitles_router
from app.api.transcription import router as transcription_router
from app.api.transcripts import router as transcripts_router
from app.api.youtube import router as youtube_router

api_router = APIRouter()
api_router.include_router(health_router)
api_router.include_router(projects_router)
api_router.include_router(assets_router)
api_router.include_router(transcripts_router)
api_router.include_router(transcription_router)
api_router.include_router(analysis_router)
api_router.include_router(audio_repair_router)
api_router.include_router(highlights_router)
api_router.include_router(reels_router)
api_router.include_router(overlays_router)
api_router.include_router(cut_suggestions_router)
api_router.include_router(framing_router)
api_router.include_router(renders_router)
api_router.include_router(subtitles_router)
api_router.include_router(end_card_router)
api_router.include_router(background_music_router)
api_router.include_router(export_profiles_router)
api_router.include_router(youtube_router)

__all__ = ["api_router"]
