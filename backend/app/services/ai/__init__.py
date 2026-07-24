"""Factory for optional AI analysis providers."""

from __future__ import annotations

import logging

from app.core.config import Settings, get_settings
from app.services.ai.base import AIProvider
from app.services.ai.mock_provider import MockAIProvider

logger = logging.getLogger(__name__)


def resolve_provider(settings: Settings | None = None) -> AIProvider:
    """Pick Gemini when a key is configured; otherwise the deterministic mock.

    The app stays fully functional without Gemini: analysis still runs via the
    mock provider so the UI and validation path can be exercised offline.
    """
    cfg = settings or get_settings()
    provider_name = (cfg.ai_provider or "auto").strip().lower()

    if provider_name == "mock":
        return MockAIProvider()

    api_key = (cfg.gemini_api_key or "").strip()
    if provider_name == "gemini" or (provider_name == "auto" and api_key):
        if not api_key:
            logger.warning("ai_provider=gemini but no API key; falling back to mock")
            return MockAIProvider()
        from app.services.ai.gemini_provider import GeminiProvider

        return GeminiProvider(
            api_key=api_key,
            model=cfg.gemini_model,
            timeout_seconds=cfg.gemini_timeout_seconds,
            max_attempts=cfg.gemini_max_attempts,
        )

    return MockAIProvider()


def provider_availability(settings: Settings | None = None) -> dict[str, object]:
    """Public status for the health / UI panels."""
    cfg = settings or get_settings()
    has_key = bool((cfg.gemini_api_key or "").strip())
    sdk_installed = False
    try:
        import google.genai  # noqa: F401

        sdk_installed = True
    except ImportError:
        sdk_installed = False

    resolved = resolve_provider(cfg)
    return {
        "requested": cfg.ai_provider,
        "active": resolved.name,
        "gemini_configured": has_key,
        "gemini_sdk_installed": sdk_installed,
        "gemini_model": cfg.gemini_model,
        "optional": True,
    }
