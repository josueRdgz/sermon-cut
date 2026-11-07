"""Groq analysis provider using the public OpenAI-compatible Chat API."""

from __future__ import annotations

import json

from app.core.exceptions import ValidationAppError
from app.services.ai.base import AIProvider
from app.services.ai.groq_client import DEFAULT_GROQ_MODEL, GroqError, chat_json
from app.services.ai.prompts import build_merge_prompt, build_user_prompt, system_prompt
from app.services.ai.schemas import AnalysisRequest, AnalysisResponse, ProviderResult


class GroqProvider(AIProvider):
    name = "groq"

    def __init__(
        self,
        *,
        api_key: str,
        model: str = DEFAULT_GROQ_MODEL,
        timeout_seconds: float = 90.0,
        max_attempts: int = 3,
    ) -> None:
        if not api_key.strip():
            raise ValidationAppError("Falta la clave de Groq.", code="groq_key_missing")
        self._api_key = api_key.strip()
        self._model = model
        self._timeout_seconds = timeout_seconds
        self._max_attempts = max_attempts

    def analyze(self, request: AnalysisRequest) -> ProviderResult:
        return self._generate(
            system=system_prompt(editorial_style=request.preferences.additional_instructions),
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
            system=system_prompt(editorial_style=request.preferences.additional_instructions),
            user=build_merge_prompt(
                request=request,
                candidate_json=json.dumps(payload, ensure_ascii=False),
            ),
        )

    def _generate(self, *, system: str, user: str) -> ProviderResult:
        text, usage = chat_json(
            api_key=self._api_key,
            model=self._model,
            system=system,
            user=user,
            timeout_seconds=self._timeout_seconds,
            max_attempts=self._max_attempts,
        )
        try:
            parsed = AnalysisResponse.model_validate_json(text)
        except Exception:
            try:
                parsed = AnalysisResponse.model_validate(json.loads(text))
            except Exception as nested:  # noqa: BLE001
                raise GroqError(
                    "La respuesta de Groq no coincide con el esquema de análisis.",
                    code="groq_invalid_json",
                ) from nested
        return ProviderResult(response=parsed, usage=usage, raw_text=text)
