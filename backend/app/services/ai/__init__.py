"""Factory for optional AI analysis providers."""

from __future__ import annotations

import logging

from app.core.config import Settings, get_settings
from app.services.ai.base import AIProvider
from app.services.ai.groq_client import DEFAULT_GROQ_MODEL
from app.services.ai.mock_provider import MockAIProvider

logger = logging.getLogger(__name__)


def _gemini_provider(cfg: Settings) -> AIProvider | None:
    api_key = (cfg.gemini_api_key or "").strip()
    if not api_key:
        return None
    from app.services.ai.gemini_provider import GeminiProvider

    return GeminiProvider(
        api_key=api_key,
        model=cfg.gemini_model,
        timeout_seconds=cfg.gemini_timeout_seconds,
        max_attempts=cfg.gemini_max_attempts,
    )


def _groq_provider(cfg: Settings) -> AIProvider | None:
    api_key = (cfg.groq_api_key or "").strip()
    if not api_key:
        return None
    from app.services.ai.groq_provider import GroqProvider

    return GroqProvider(
        api_key=api_key,
        model=cfg.groq_model or DEFAULT_GROQ_MODEL,
        timeout_seconds=cfg.groq_timeout_seconds,
        max_attempts=cfg.groq_max_attempts,
    )


def resolve_provider(settings: Settings | None = None) -> AIProvider:
    """Pick Gemini, Groq or the deterministic mock.

    ``auto`` uses Gemini when a key is present and falls back to Groq on 5xx.
    The app stays fully functional without any LLM key via the mock provider.
    """
    cfg = settings or get_settings()
    provider_name = (cfg.ai_provider or "auto").strip().lower()

    if provider_name == "mock":
        return MockAIProvider()

    gemini = _gemini_provider(cfg)
    groq = _groq_provider(cfg)

    if provider_name == "gemini":
        if gemini is None:
            logger.warning("ai_provider=gemini but no API key; falling back to mock")
            return MockAIProvider()
        return gemini

    if provider_name == "groq":
        if groq is None:
            logger.warning("ai_provider=groq but no API key; falling back to mock")
            return MockAIProvider()
        return groq

    if gemini is not None and groq is not None:
        from app.services.ai.fallback import FallbackAIProvider

        return FallbackAIProvider(gemini, groq)
    if gemini is not None:
        return gemini
    if groq is not None:
        return groq
    return MockAIProvider()


def provider_availability(settings: Settings | None = None) -> dict[str, object]:
    """Public status for the health / UI panels."""
    cfg = settings or get_settings()
    has_gemini = bool((cfg.gemini_api_key or "").strip())
    has_groq = bool((cfg.groq_api_key or "").strip())
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
        "gemini_configured": has_gemini,
        "gemini_sdk_installed": sdk_installed,
        "gemini_model": cfg.gemini_model,
        "groq_configured": has_groq,
        "groq_model": cfg.groq_model,
        "optional": True,
    }
