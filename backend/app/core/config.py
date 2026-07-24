"""Application settings loaded from environment variables / .env."""

from __future__ import annotations

from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict

from app.core.paths import ROOT_DIR, default_database_url


class Settings(BaseSettings):
    """Runtime configuration.

    Values can be overridden via environment variables prefixed with
    ``SERMON_CUT_`` or through a ``.env`` file at the repository root.
    """

    model_config = SettingsConfigDict(
        env_file=str(ROOT_DIR / ".env"),
        env_prefix="SERMON_CUT_",
        extra="ignore",
    )

    app_name: str = "Sermon Cut"
    api_prefix: str = "/api"

    database_url: str = default_database_url()

    # CORS is intentionally limited to the local Vite dev server only.
    cors_origins: list[str] = [
        "http://localhost:5173",
        "http://127.0.0.1:5173",
    ]

    # Maximum size for a single uploaded file (video or cover). Default: 4 GiB.
    max_upload_bytes: int = 4 * 1024 * 1024 * 1024


@lru_cache
def get_settings() -> Settings:
    """Return a cached Settings instance."""
    return Settings()
