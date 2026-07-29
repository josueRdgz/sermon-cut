"""Application settings loaded from environment variables / .env."""

from __future__ import annotations

import os
from functools import lru_cache

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict

from app.core.paths import ROOT_DIR, default_database_url


def _settings_env_file() -> str:
    """Use the per-user desktop config when the native shell provides it."""
    override = os.environ.get("SERMON_CUT_ENV_FILE", "").strip()
    return override or str(ROOT_DIR / ".env")


class Settings(BaseSettings):
    """Runtime configuration.

    Values can be overridden via environment variables prefixed with
    ``SERMON_CUT_`` or through a ``.env`` file at the repository root.
    """

    model_config = SettingsConfigDict(
        env_file=_settings_env_file(),
        env_prefix="SERMON_CUT_",
        extra="ignore",
    )

    app_name: str = "Sermon Cut"
    app_version: str = "0.1.0"
    api_prefix: str = "/api"

    # Optional override for local media + SQLite (absolute or relative path).
    # When empty, defaults to ``<repo>/storage``.
    storage_dir: str | None = None

    database_url: str = Field(default_factory=default_database_url)

    # Run ``alembic upgrade head`` when the API starts. Failures are logged and
    # do not abort startup unless you run migrations manually with --raise.
    auto_migrate: bool = True

    # CORS: Vite dev server + Tauri webview origins (desktop shell).
    cors_origins: list[str] = Field(
        default_factory=lambda: [
            "http://localhost:5173",
            "http://127.0.0.1:5173",
            "tauri://localhost",
            "https://tauri.localhost",
            "http://tauri.localhost",
            "https://asset.localhost",
            "http://asset.localhost",
        ]
    )

    # Maximum size for a single uploaded *video*. Default: 4 GiB.
    max_upload_bytes: int = 4 * 1024 * 1024 * 1024
    # Covers / logos / music must stay much smaller (disk DoS + decode cost).
    max_cover_upload_bytes: int = 20 * 1024 * 1024
    max_music_upload_bytes: int = 100 * 1024 * 1024

    # ---- Local transcription (faster-whisper) ----
    whisper_model: str = "small"
    whisper_device: str = "auto"
    whisper_compute_type: str = "auto"
    keep_temp_audio: bool = False

    min_reel_segment_seconds: float = 0.1

    # Optional explicit FFmpeg executable. On macOS the renderer automatically
    # prefers Homebrew's keg-only ffmpeg-full build when it is installed.
    ffmpeg_path: str | None = None

    # ---- Optional AI analysis (Gemini) ----
    ai_provider: str = "auto"
    gemini_api_key: str | None = None
    gemini_model: str = "gemini-2.5-flash"
    gemini_timeout_seconds: float = 90.0
    gemini_max_attempts: int = 3
    ai_chunk_char_limit: int = 48_000
    # Editorial pacing: prefer long, continuous source windows over rapid cuts.
    ai_max_segments_per_reel: int = 3
    ai_min_segment_seconds: float = 8.0
    ai_merge_gap_seconds: float = 1.25

    # ---- Loudness (spoken-word friendly) ----
    target_lufs: float = -16.0
    true_peak_db: float = -1.5
    loudness_lra: float = 11.0

    # ---- Optional YouTube import (yt-dlp) ----
    # Local file upload always stays the primary, stable method. This is opt-in.
    youtube_import_enabled: bool = True
    # Explicit path to the yt-dlp executable. When empty it is resolved on PATH.
    ytdlp_path: str | None = None
    # Default requested quality: "720p" | "1080p" | "best". Never 4K by default.
    youtube_default_quality: str = "1080p"
    # Reject videos longer than this (seconds). Default: 4 hours.
    youtube_max_duration_seconds: int = 4 * 60 * 60
    # Refuse to start if the estimated download exceeds this size. Default 8 GiB.
    youtube_max_estimated_bytes: int = 8 * 1024 * 1024 * 1024
    # Require at least this much free disk (bytes) beyond the estimate. 1 GiB.
    youtube_min_free_bytes: int = 1 * 1024 * 1024 * 1024
    # Seconds to wait for metadata extraction before giving up.
    youtube_metadata_timeout_seconds: float = 60.0


@lru_cache
def get_settings() -> Settings:
    """Return a cached Settings instance."""
    return Settings()


def clear_settings_cache() -> None:
    """Drop the cached settings (useful after changing env in tests/CLI)."""
    get_settings.cache_clear()
