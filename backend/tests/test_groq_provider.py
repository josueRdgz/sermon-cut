"""Groq provider parsing and Gemini→Groq failover."""

from __future__ import annotations

import json

from app.services.ai.fallback import FallbackAIProvider, should_failover
from app.services.ai.gemini_provider import GeminiProviderError
from app.services.ai.groq_provider import GroqProvider
from app.services.ai.schemas import (
    AnalysisPreferences,
    AnalysisRequest,
    AnalysisResponse,
    ProviderResult,
    SermonMetadata,
    SuggestedClip,
    SuggestedSegment,
    TranscriptSegmentInput,
)


def _request() -> AnalysisRequest:
    return AnalysisRequest(
        metadata=SermonMetadata(
            title="Gracia",
            church_name="Iglesia",
            youtube_channel="@x",
            duration_seconds=120,
        ),
        segments=[
            TranscriptSegmentInput(
                order=0,
                start=0.0,
                end=12.0,
                text="La gracia de Dios es suficiente.",
            )
        ],
        preferences=AnalysisPreferences(max_reels=1, min_duration_seconds=10, max_duration_seconds=40),
    )


def test_should_failover_on_gemini_503() -> None:
    assert should_failover(GeminiProviderError("Gemini analysis failed: 503 Unavailable"))
    assert should_failover(RuntimeError("503 UNAVAILABLE"))
    assert not should_failover(ValueError("exact_text not found"))


def test_groq_provider_parses_chat_completion(monkeypatch) -> None:
    payload = {
        "clips": [
            {
                "title": "La gracia basta",
                "hook": "La gracia de Dios es suficiente.",
                "summary": "Una idea",
                "editorial_score": 8,
                "segments": [
                    {
                        "start": 0.0,
                        "end": 12.0,
                        "exact_text": "La gracia de Dios es suficiente.",
                        "reason": "tesis",
                    }
                ],
            }
        ]
    }

    def fake_chat_json(**kwargs):
        return json.dumps(payload), None

    monkeypatch.setattr("app.services.ai.groq_provider.chat_json", fake_chat_json)
    result = GroqProvider(api_key="gsk_test").analyze(_request())
    assert result.response.clips[0].title == "La gracia basta"


def test_fallback_uses_groq_and_sets_notice() -> None:
    class Boom:
        name = "gemini"

        def analyze(self, request):
            raise GeminiProviderError("Gemini no respondió.")

        def merge_candidates(self, request, chunk_results):
            raise GeminiProviderError("Gemini no respondió.")

    class Ok:
        name = "groq"

        def analyze(self, request):
            return ProviderResult(
                response=AnalysisResponse(
                    clips=[
                        SuggestedClip(
                            title="Respaldo",
                            segments=[
                                SuggestedSegment(
                                    start=0.0,
                                    end=10.0,
                                    exact_text="La gracia de Dios es suficiente.",
                                )
                            ],
                        )
                    ]
                )
            )

        def merge_candidates(self, request, chunk_results):
            return chunk_results[0]

    provider = FallbackAIProvider(Boom(), Ok())
    result = provider.analyze(_request())
    assert result.notice == "Gemini no respondió; se usó Groq."
    assert result.response.clips[0].title == "Respaldo"
