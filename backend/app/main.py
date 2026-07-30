"""FastAPI application entrypoint for Sermon Cut."""

from __future__ import annotations

import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.api import api_router
from app.core.config import get_settings
from app.core.exceptions import AppError
from app.core.migrate import run_migrations
from app.core.paths import configure_paths, ensure_storage_dirs

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(_app: FastAPI) -> AsyncIterator[None]:
    """Reconcile stale jobs on boot; cancel workers on shutdown."""
    from app.db.session import SessionLocal
    from app.services.job_recovery import reconcile_stale_jobs
    from app.services.storage import prune_empty_project_dirs

    db = SessionLocal()
    try:
        reconcile_stale_jobs(db)
    except Exception:  # noqa: BLE001 — never block API startup on recovery
        logger.exception("Failed to reconcile stale jobs on startup")
    finally:
        db.close()

    try:
        removed = prune_empty_project_dirs()
        if removed:
            logger.info("Removed %d empty project storage directories", removed)
    except Exception:  # noqa: BLE001 — storage cleanup must not block startup
        logger.exception("Failed to prune empty project directories on startup")

    yield

    try:
        from app.services.analysis.manager import get_analysis_manager
        from app.services.render.manager import get_render_manager
        from app.services.whisper.manager import get_job_manager
        from app.services.youtube.manager import get_youtube_import_manager

        get_render_manager().shutdown(wait=False)
        get_job_manager().shutdown(wait=False)
        get_analysis_manager().shutdown(wait=False)
        get_youtube_import_manager().shutdown(wait=False)
    except Exception:  # noqa: BLE001
        logger.exception("Error while shutting down job managers")


def create_app() -> FastAPI:
    """Application factory: build and configure the FastAPI instance."""
    settings = get_settings()
    # Only rebind roots when the user configured an override — leave test
    # monkeypatches (and the env-based default from import time) alone.
    if settings.storage_dir:
        configure_paths(settings.storage_dir)
    ensure_storage_dirs()

    if settings.auto_migrate:
        ok = run_migrations(raise_on_error=False)
        if not ok:
            logger.warning(
                "Arranque sin migraciones aplicadas. "
                "Ejecuta: cd backend && alembic upgrade head"
            )

    app = FastAPI(title=settings.app_name, version=settings.app_version, lifespan=lifespan)

    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    @app.exception_handler(AppError)
    async def handle_app_error(_request: Request, exc: AppError) -> JSONResponse:
        return JSONResponse(
            status_code=exc.status_code,
            content={"detail": exc.detail, "code": exc.code},
        )

    app.include_router(api_router, prefix=settings.api_prefix)
    return app


app = create_app()
