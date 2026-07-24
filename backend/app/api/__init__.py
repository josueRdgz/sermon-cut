"""API routers.

Aggregates every router under a single ``api_router`` mounted with the
configured prefix (default ``/api``).
"""

from __future__ import annotations

from fastapi import APIRouter

from app.api.health import router as health_router

api_router = APIRouter()
api_router.include_router(health_router)

__all__ = ["api_router"]
