"""Try Gemini first, then Groq, without leaking raw 503 messages."""

from __future__ import annotations

import logging

from app.services.ai.base import AIProvider
from app.services.ai.gemini_provider import GeminiProviderError
from app.services.ai.schemas import AnalysisRequest, ProviderResult

logger = logging.getLogger(__name__)


class FallbackAIProvider(AIProvider):
    name = "auto"

    def __init__(self, primary: AIProvider, fallback: AIProvider) -> None:
        self._primary = primary
        self._fallback = fallback

    def analyze(self, request: AnalysisRequest) -> ProviderResult:
        try:
            return self._primary.analyze(request)
        except Exception as exc:  # noqa: BLE001
            if not should_failover(exc):
                raise
            logger.warning("Gemini no respondió (%s); se usa Groq.", exc)
            result = self._fallback.analyze(request)
            return result.model_copy(update={"notice": "Gemini no respondió; se usó Groq."})

    def merge_candidates(
        self,
        request: AnalysisRequest,
        chunk_results: list[ProviderResult],
    ) -> ProviderResult:
        try:
            return self._primary.merge_candidates(request, chunk_results)
        except Exception as exc:  # noqa: BLE001
            if not should_failover(exc):
                raise
            logger.warning("Gemini no respondió al combinar (%s); se usa Groq.", exc)
            result = self._fallback.merge_candidates(request, chunk_results)
            return result.model_copy(update={"notice": "Gemini no respondió; se usó Groq."})


def should_failover(exc: Exception) -> bool:
    if isinstance(exc, GeminiProviderError):
        return True
    status = getattr(exc, "status_code", None)
    if isinstance(status, int) and status in {408, 429, 500, 502, 503, 504}:
        return True
    text = f"{type(exc).__name__} {exc}".lower()
    return any(
        marker in text
        for marker in ("503", "429", "unavailable", "overloaded", "rate limit", "capacity")
    )
