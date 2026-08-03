"""Deterministic mock AI provider for tests and offline demos.

Never calls the network. Builds candidates from real transcript windows so
downstream validation (exact_text, timing) can be exercised end-to-end.
"""

from __future__ import annotations

from app.services.ai.base import AIProvider
from app.services.ai.schemas import (
    AnalysisRequest,
    AnalysisResponse,
    ProviderResult,
    ProviderUsage,
    StrategicTitleSet,
    SuggestedClip,
    SuggestedSegment,
    TranscriptSegmentInput,
)


class MockAIProvider(AIProvider):
    """Select evenly spaced windows and optionally join non-consecutive ones."""

    name = "mock"

    def analyze(self, request: AnalysisRequest) -> ProviderResult:
        prefs = request.preferences
        timed = [
            segment
            for segment in request.segments
            if segment.end > segment.start and segment.text.strip()
        ]
        if not timed:
            return ProviderResult(
                response=AnalysisResponse(clips=[]),
                usage=ProviderUsage(model="mock", total_tokens=0),
            )

        target = (prefs.min_duration_seconds + prefs.max_duration_seconds) / 2.0
        clips: list[SuggestedClip] = []

        # Walk the transcript building non-overlapping candidates.
        cursor = 0
        while cursor < len(timed) and len(clips) < prefs.max_reels:
            primary = timed[cursor]
            collected = [primary]
            duration = primary.end - primary.start
            next_index = cursor + 1

            # Grow within the contiguous run until we approach the target.
            while next_index < len(timed) and duration < target:
                candidate = timed[next_index]
                gap = candidate.start - collected[-1].end
                if gap > 8.0:
                    break
                if duration + (candidate.end - candidate.start) > prefs.max_duration_seconds:
                    break
                collected.append(candidate)
                duration += candidate.end - candidate.start
                next_index += 1

            # If still short, jump ahead to a later non-consecutive segment.
            jump = next_index + 2
            if duration < prefs.min_duration_seconds and jump < len(timed):
                extra = timed[jump]
                extra_dur = extra.end - extra.start
                if duration + extra_dur <= prefs.max_duration_seconds:
                    collected.append(extra)
                    duration += extra_dur
                    next_index = max(next_index, jump + 1)

            if duration < prefs.min_duration_seconds * 0.5:
                cursor = max(cursor + 1, next_index)
                continue

            groups: list[list[TranscriptSegmentInput]] = []
            for item in collected:
                if groups and item.start - groups[-1][-1].end <= 1.25:
                    groups[-1].append(item)
                elif len(groups) < prefs.max_segments_per_reel:
                    groups.append([item])
                else:
                    break

            segments = []
            for group in groups:
                first = group[0]
                last = group[-1]
                segments.append(
                    SuggestedSegment(
                        start=first.start,
                        end=last.end,
                        exact_text=" ".join(item.text.strip() for item in group),
                        reason="Momento claro y autosuficiente respaldado por la transcripción.",
                    )
                )
            joined = " ".join(seg.exact_text for seg in segments)
            title_seed = collected[0].text.strip().split()
            title = " ".join(title_seed[:8]) or f"Clip {len(clips) + 1}"
            if len(title) > 80:
                title = title[:77] + "…"

            warning = None
            if len(collected) > 1 and any(
                collected[i].start - collected[i - 1].end > 1.0 for i in range(1, len(collected))
            ):
                warning = (
                    "Se unieron fragmentos no consecutivos; revisa que el "
                    "sentido del predicador se conserve."
                )

            clips.append(
                SuggestedClip(
                    title=title,
                    hook=segments[0].exact_text[:180],
                    summary=joined[:400],
                    editorial_score=round(7.5 - 0.2 * len(clips), 1),
                    segments=segments,
                    joined_script=joined,
                    removed_context_warning=warning,
                    caption=joined[:200],
                    hashtags=["#sermon", "#fe", "#gracia"],
                    suggested_titles=StrategicTitleSet(
                        recommended=title,
                        direct=title,
                        emotional=f"Una verdad que transforma: {title}"[:300],
                        biblical=f"Enseñanza bíblica: {title}"[:300],
                        search_focused=f"Qué enseña la Biblia sobre {title}"[:300],
                    ),
                    thumbnail_text=" ".join(title.upper().split()[:5]),
                    keywords=[word.lower() for word in title_seed[:8]],
                )
            )
            cursor = max(cursor + 1, next_index)

        return ProviderResult(
            response=AnalysisResponse(clips=clips),
            usage=ProviderUsage(
                model="mock",
                prompt_tokens=len(timed) * 20,
                completion_tokens=len(clips) * 40,
                total_tokens=len(timed) * 20 + len(clips) * 40,
            ),
        )
