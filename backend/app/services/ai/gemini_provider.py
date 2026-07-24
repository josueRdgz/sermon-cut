"""Gemini provider using the official ``google-genai`` SDK.

The application remains fully usable without this module: the analysis manager
falls back to the mock provider when no API key is configured or the extra is
not installed.
"""

from __future__ import annotations

import json
import logging
import time
from typing import Any

from app.core.exceptions import AppError, ValidationAppError
from app.services.ai.base import AIProvider
from app.services.ai.prompts import SYSTEM_PROMPT, build_merge_prompt, build_user_prompt
from app.services.ai.schemas import (
    AnalysisRequest,
    AnalysisResponse,
    ProviderResult,
    ProviderUsage,
)

logger = logging.getLogger(__name__)

# Transient HTTP / RPC codes worth a bounded retry.
_RETRYABLE_STATUS = {408, 429, 500, 502, 503, 504}
_MAX_ATTEMPTS = 3
_BACKOFF_SECONDS = (1.0, 2.0, 4.0)


class GeminiProviderError(AppError):
    """Raised when Gemini cannot complete an analysis call."""

    def __init__(self, detail: str, *, code: str = "gemini_error", status_code: int = 502) -> None:
        super().__init__(detail, code=code, status_code=status_code)


class GeminiProvider(AIProvider):
    """Calls Gemini with structured JSON output and validates via Pydantic."""

    name = "gemini"

    def __init__(
        self,
        *,
        api_key: str,
        model: str = "gemini-2.5-flash",
        timeout_seconds: float = 90.0,
        max_attempts: int = _MAX_ATTEMPTS,
    ) -> None:
        if not api_key.strip():
            raise ValidationAppError(
                "Gemini API key is missing.",
                code="gemini_key_missing",
            )
        self._api_key = api_key.strip()
        self._model = model
        self._timeout_seconds = timeout_seconds
        self._max_attempts = max(1, min(max_attempts, _MAX_ATTEMPTS))
        self._client: Any | None = None

    def _get_client(self) -> Any:
        if self._client is not None:
            return self._client
        try:
            from google import genai
        except ImportError as exc:
            raise GeminiProviderError(
                "The google-genai package is not installed. "
                'Install it with: pip install -e ".[gemini]"',
                code="gemini_sdk_missing",
                status_code=503,
            ) from exc
        self._client = genai.Client(
            api_key=self._api_key,
            http_options={"timeout": int(self._timeout_seconds * 1000)},
        )
        return self._client

    def analyze(self, request: AnalysisRequest) -> ProviderResult:
        return self._generate(
            system=SYSTEM_PROMPT,
            user=build_user_prompt(request),
        )

    def merge_candidates(
        self,
        request: AnalysisRequest,
        chunk_results: list[ProviderResult],
    ) -> ProviderResult:
        if len(chunk_results) <= 1:
            return super().merge_candidates(request, chunk_results)

        payload = {
            "chunks": [
                {
                    "chunk_index": index,
                    "clips": result.response.model_dump(mode="json"),
                }
                for index, result in enumerate(chunk_results)
            ]
        }
        return self._generate(
            system=SYSTEM_PROMPT,
            user=build_merge_prompt(
                request=request,
                candidate_json=json.dumps(payload, ensure_ascii=False),
            ),
        )

    def _generate(self, *, system: str, user: str) -> ProviderResult:
        client = self._get_client()
        last_error: Exception | None = None

        for attempt in range(self._max_attempts):
            try:
                response = client.models.generate_content(
                    model=self._model,
                    contents=user,
                    config={
                        "system_instruction": system,
                        "response_mime_type": "application/json",
                        "response_json_schema": AnalysisResponse.model_json_schema(),
                        "temperature": 0.2,
                    },
                )
                return self._parse_response(response)
            except Exception as exc:  # noqa: BLE001 — classify then retry or raise
                last_error = exc
                if not _is_retryable(exc) or attempt >= self._max_attempts - 1:
                    break
                delay = _BACKOFF_SECONDS[min(attempt, len(_BACKOFF_SECONDS) - 1)]
                logger.warning(
                    "Gemini transient error (attempt %s/%s): %s; retrying in %.1fs",
                    attempt + 1,
                    self._max_attempts,
                    exc,
                    delay,
                )
                time.sleep(delay)

        raise GeminiProviderError(
            f"Gemini analysis failed: {last_error}",
            code="gemini_request_failed",
        ) from last_error

    def _parse_response(self, response: Any) -> ProviderResult:
        text = getattr(response, "text", None)
        if not text:
            # Some SDK versions expose candidates instead of .text.
            text = _extract_text(response)
        if not text:
            raise GeminiProviderError(
                "Gemini returned an empty response.",
                code="gemini_empty_response",
            )

        try:
            parsed = AnalysisResponse.model_validate_json(text)
        except Exception as exc:  # noqa: BLE001 — wrap validation for the API
            # Fall back to json.loads in case the payload has a BOM / fence.
            try:
                data = json.loads(text)
                parsed = AnalysisResponse.model_validate(data)
            except Exception as nested:  # noqa: BLE001
                raise GeminiProviderError(
                    f"Gemini response failed Pydantic validation: {exc}",
                    code="gemini_invalid_json",
                ) from nested

        usage = _usage_from_response(response, model=self._model)
        if usage is not None:
            logger.info(
                "Gemini usage model=%s prompt=%s completion=%s total=%s",
                usage.model,
                usage.prompt_tokens,
                usage.completion_tokens,
                usage.total_tokens,
            )
        return ProviderResult(response=parsed, usage=usage, raw_text=text)


def _extract_text(response: Any) -> str | None:
    candidates = getattr(response, "candidates", None) or []
    for candidate in candidates:
        content = getattr(candidate, "content", None)
        parts = getattr(content, "parts", None) or []
        for part in parts:
            value = getattr(part, "text", None)
            if value:
                return value
    return None


def _usage_from_response(response: Any, *, model: str) -> ProviderUsage | None:
    meta = getattr(response, "usage_metadata", None)
    if meta is None:
        return None
    return ProviderUsage(
        prompt_tokens=_optional_int(getattr(meta, "prompt_token_count", None)),
        completion_tokens=_optional_int(getattr(meta, "candidates_token_count", None)),
        total_tokens=_optional_int(getattr(meta, "total_token_count", None)),
        model=model,
    )


def _optional_int(value: object) -> int | None:
    if value is None:
        return None
    try:
        return int(value)  # type: ignore[arg-type]
    except (TypeError, ValueError):
        return None


def _is_retryable(exc: Exception) -> bool:
    status = getattr(exc, "status_code", None) or getattr(exc, "code", None)
    if isinstance(status, int) and status in _RETRYABLE_STATUS:
        return True
    name = type(exc).__name__.lower()
    message = str(exc).lower()
    markers = ("timeout", "temporarily", "unavailable", "rate limit", "429", "503", "500")
    return any(marker in name or marker in message for marker in markers)
