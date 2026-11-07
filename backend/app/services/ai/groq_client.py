"""Minimal Groq Chat Completions client (OpenAI-compatible, stdlib only)."""

from __future__ import annotations

import json
import logging
import time
import urllib.error
import urllib.request
from typing import Any

from app.core.exceptions import AppError, ValidationAppError
from app.services.ai.schemas import ProviderUsage

logger = logging.getLogger(__name__)

GROQ_CHAT_URL = "https://api.groq.com/openai/v1/chat/completions"
DEFAULT_GROQ_MODEL = "llama-3.3-70b-versatile"
_RETRYABLE_STATUS = {408, 429, 500, 502, 503, 504}
_BACKOFF_SECONDS = (1.0, 2.0, 4.0)


class GroqError(AppError):
    def __init__(self, detail: str, *, code: str = "groq_error", status_code: int = 502) -> None:
        super().__init__(detail, code=code, status_code=status_code)


def chat_json(
    *,
    api_key: str,
    model: str,
    system: str,
    user: str,
    timeout_seconds: float = 90.0,
    max_attempts: int = 3,
    temperature: float = 0.2,
) -> tuple[str, ProviderUsage | None]:
    """Return the assistant JSON text and optional usage."""
    key = api_key.strip()
    if not key:
        raise ValidationAppError("Falta la clave de Groq.", code="groq_key_missing")

    payload = {
        "model": model,
        "temperature": temperature,
        "response_format": {"type": "json_object"},
        "messages": [
            {"role": "system", "content": system},
            {"role": "user", "content": user},
        ],
    }
    last_error: Exception | None = None
    attempts = max(1, min(max_attempts, 3))
    for attempt in range(attempts):
        try:
            data = _post(payload, api_key=key, timeout_seconds=timeout_seconds)
            text = _message_text(data)
            if not text:
                raise GroqError("Groq devolvió una respuesta vacía.", code="groq_empty_response")
            return text, _usage_from_payload(data, model=model)
        except GroqError as exc:
            last_error = exc
            if not _is_retryable(exc) or attempt >= attempts - 1:
                break
            delay = _BACKOFF_SECONDS[min(attempt, len(_BACKOFF_SECONDS) - 1)]
            logger.warning(
                "Groq transient error (attempt %s/%s): %s; retrying in %.1fs",
                attempt + 1,
                attempts,
                exc,
                delay,
            )
            time.sleep(delay)
        except Exception as exc:  # noqa: BLE001
            last_error = exc
            if not _is_retryable(exc) or attempt >= attempts - 1:
                break
            delay = _BACKOFF_SECONDS[min(attempt, len(_BACKOFF_SECONDS) - 1)]
            logger.warning(
                "Groq transient error (attempt %s/%s): %s; retrying in %.1fs",
                attempt + 1,
                attempts,
                exc,
                delay,
            )
            time.sleep(delay)

    raise GroqError(
        "Groq no respondió. Inténtalo más tarde o revisa la clave en Ajustes.",
        code="groq_request_failed",
    ) from last_error


def _post(payload: dict[str, Any], *, api_key: str, timeout_seconds: float) -> dict[str, Any]:
    request = urllib.request.Request(
        GROQ_CHAT_URL,
        data=json.dumps(payload).encode("utf-8"),
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=timeout_seconds) as response:
            raw = response.read().decode("utf-8")
    except urllib.error.HTTPError as exc:
        body = exc.read().decode("utf-8", errors="replace")[:300]
        logger.warning("Groq HTTP %s: %s", exc.code, body)
        raise GroqError(
            "Groq no respondió. Inténtalo más tarde o revisa la clave en Ajustes.",
            code="groq_http_error",
            status_code=exc.code if exc.code in _RETRYABLE_STATUS else 502,
        ) from exc
    except urllib.error.URLError as exc:
        raise GroqError(
            "No se pudo contactar con Groq.",
            code="groq_network_error",
        ) from exc
    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise GroqError("Groq devolvió JSON inválido.", code="groq_invalid_json") from exc
    if not isinstance(parsed, dict):
        raise GroqError("Groq devolvió JSON inválido.", code="groq_invalid_json")
    return parsed


def _message_text(payload: dict[str, Any]) -> str:
    choices = payload.get("choices") or []
    if not choices:
        return ""
    message = choices[0].get("message") or {}
    content = message.get("content")
    return content.strip() if isinstance(content, str) else ""


def _usage_from_payload(payload: dict[str, Any], *, model: str) -> ProviderUsage | None:
    usage = payload.get("usage")
    if not isinstance(usage, dict):
        return None
    return ProviderUsage(
        prompt_tokens=_optional_int(usage.get("prompt_tokens")),
        completion_tokens=_optional_int(usage.get("completion_tokens")),
        total_tokens=_optional_int(usage.get("total_tokens")),
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
    status = getattr(exc, "status_code", None)
    if isinstance(status, int) and status in _RETRYABLE_STATUS:
        return True
    text = f"{type(exc).__name__} {exc}".lower()
    markers = ("timeout", "unavailable", "rate limit", "429", "503", "500")
    return any(marker in text for marker in markers)
