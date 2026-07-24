"""Abstract interface for optional AI analysis providers."""

from __future__ import annotations

from abc import ABC, abstractmethod

from app.services.ai.schemas import AnalysisRequest, ProviderResult


class AIProvider(ABC):
    """Provider that suggests Reels from a timed transcript.

    Implementations must be side-effect free beyond the remote call itself.
    Validation, persistence and Reel creation live outside the provider.
    """

    name: str = "base"

    @abstractmethod
    def analyze(self, request: AnalysisRequest) -> ProviderResult:
        """Return a Pydantic-validated analysis response."""

    def merge_candidates(
        self,
        request: AnalysisRequest,
        chunk_results: list[ProviderResult],
    ) -> ProviderResult:
        """Optional final stage that combines per-chunk candidates.

        The default concatenates clips and trims to ``max_reels``, ranked by
        editorial score. Providers that speak to a model may override this.
        """
        from app.services.ai.schemas import AnalysisResponse

        clips = []
        for result in chunk_results:
            clips.extend(result.response.clips)
        clips.sort(key=lambda clip: clip.editorial_score, reverse=True)
        trimmed = clips[: request.preferences.max_reels]
        return ProviderResult(response=AnalysisResponse(clips=trimmed))
