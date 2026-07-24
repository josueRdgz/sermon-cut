"""FastAPI application entrypoint for Sermon Cut."""

from __future__ import annotations

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api import api_router
from app.core.config import get_settings
from app.core.paths import ensure_storage_dirs


def create_app() -> FastAPI:
    """Application factory: build and configure the FastAPI instance."""
    settings = get_settings()
    ensure_storage_dirs()

    app = FastAPI(title=settings.app_name, version="0.1.0")

    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    app.include_router(api_router, prefix=settings.api_prefix)
    return app


app = create_app()
