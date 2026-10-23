"""Read and persist user-facing runtime settings into the active .env file."""

from __future__ import annotations

import os
from pathlib import Path

from app.core.config import Settings, _settings_env_file, clear_settings_cache, get_settings
from app.core.exceptions import ValidationAppError
from app.schemas.health import ToolInfo
from app.schemas.settings import (
    AI_PROVIDERS,
    WHISPER_MODELS,
    AppSettingsResponse,
    AppSettingsUpdate,
)
from app.services.ffmpeg import get_ffmpeg_status, get_ffprobe_status
from app.services.system_stats import gemini_status, whisper_status

_EDITABLE_KEYS = (
    "SERMON_CUT_GEMINI_API_KEY",
    "SERMON_CUT_GEMINI_MODEL",
    "SERMON_CUT_AI_PROVIDER",
    "SERMON_CUT_WHISPER_MODEL",
)


def mask_secret(value: str | None) -> str | None:
    if not value:
        return None
    if len(value) <= 8:
        return "••••••••"
    return f"{value[:4]}…{value[-4:]}"


def _parse_env_file(path: Path) -> list[tuple[str | None, str]]:
    """Return (key, original_line) pairs; key is None for comments/blank lines."""
    if not path.is_file():
        return []
    rows: list[tuple[str | None, str]] = []
    for raw in path.read_text(encoding="utf-8").splitlines():
        stripped = raw.strip()
        if not stripped or stripped.startswith("#") or "=" not in raw:
            rows.append((None, raw))
            continue
        key = stripped.split("=", 1)[0].strip()
        rows.append((key, raw))
    return rows


def _write_env_file(path: Path, updates: dict[str, str | None]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    rows = _parse_env_file(path)
    seen: set[str] = set()
    lines: list[str] = []
    for key, original in rows:
        if key is None or key not in updates:
            lines.append(original)
            continue
        seen.add(key)
        value = updates[key]
        if value is None:
            continue
        lines.append(f"{key}={value}")
    for key, value in updates.items():
        if key in seen or value is None:
            continue
        lines.append(f"{key}={value}")
    text = "\n".join(lines).rstrip() + "\n"
    path.write_text(text, encoding="utf-8")
    try:
        os.chmod(path, 0o600)
    except OSError:
        pass


def _apply_runtime(updates: dict[str, str | None]) -> None:
    for key, value in updates.items():
        env_name = key
        if value is None or value == "":
            os.environ.pop(env_name, None)
        else:
            os.environ[env_name] = value
    clear_settings_cache()


def to_response(settings: Settings | None = None) -> AppSettingsResponse:
    current = settings or get_settings()
    ffmpeg = get_ffmpeg_status()
    ffprobe = get_ffprobe_status()
    whisper = whisper_status()
    gemini = gemini_status(current)
    return AppSettingsResponse(
        whisper_model=current.whisper_model,
        whisper_models=list(WHISPER_MODELS),
        ai_provider=current.ai_provider,
        ai_providers=list(AI_PROVIDERS),
        gemini_model=current.gemini_model,
        gemini_configured=bool(current.gemini_api_key) and current.ai_provider != "mock",
        gemini_api_key_masked=mask_secret(current.gemini_api_key),
        ffmpeg=ToolInfo(available=ffmpeg.available, version=ffmpeg.version),
        ffprobe=ToolInfo(available=ffprobe.available, version=ffprobe.version),
        whisper=ToolInfo(available=whisper.available, version=whisper.version),
        gemini=ToolInfo(available=gemini.available, version=gemini.version),
    )


def update_settings(payload: AppSettingsUpdate) -> AppSettingsResponse:
    data = payload.model_dump(exclude_unset=True)
    updates: dict[str, str | None] = {}

    if data.get("clear_gemini_api_key"):
        updates["SERMON_CUT_GEMINI_API_KEY"] = None
    elif "gemini_api_key" in data and data["gemini_api_key"] is not None:
        key = data["gemini_api_key"].strip()
        if key:
            updates["SERMON_CUT_GEMINI_API_KEY"] = key

    if "gemini_model" in data and data["gemini_model"]:
        updates["SERMON_CUT_GEMINI_MODEL"] = data["gemini_model"].strip()

    if "ai_provider" in data and data["ai_provider"] is not None:
        provider = data["ai_provider"].strip().lower()
        if provider not in AI_PROVIDERS:
            raise ValidationAppError("Proveedor de IA no válido.", code="invalid_ai_provider")
        updates["SERMON_CUT_AI_PROVIDER"] = provider

    if "whisper_model" in data and data["whisper_model"] is not None:
        model = data["whisper_model"].strip()
        if model not in WHISPER_MODELS:
            raise ValidationAppError("Modelo Whisper no válido.", code="invalid_whisper_model")
        updates["SERMON_CUT_WHISPER_MODEL"] = model

    if not updates:
        return to_response()

    env_path = Path(_settings_env_file())
    _write_env_file(env_path, updates)
    _apply_runtime(updates)
    return to_response()
