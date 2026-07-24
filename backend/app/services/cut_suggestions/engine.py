"""Build optional technical cut suggestions from silence + transcript cues."""

from __future__ import annotations

import uuid
from dataclasses import dataclass

from app.schemas.cut_suggestions import (
    CutIntensity,
    CutSuggestion,
    CutSuggestionKind,
    CutSuggestionStatus,
)
from app.services.cut_suggestions.fillers import (
    TimedToken,
    detect_filler_hits,
    tokens_from_words,
)
from app.services.cut_suggestions.intensity import IntensityProfile
from app.services.cut_suggestions.silence import SilenceInterval


def _silence_cut_message(
    kind: CutSuggestionKind,
    duration: float,
    removed: float,
    residual: float,
) -> str:
    label = "Pausa larga" if kind == CutSuggestionKind.long_pause else "Silencio interno"
    return (
        f"{label} de {duration:.2f}s. Se sugiere reducir ~{removed:.2f}s "
        f"dejando {residual:.2f}s y un crossfade corto."
    )


@dataclass(frozen=True)
class SegmentInput:
    index: int  # 1-based
    uuid: uuid.UUID
    start: float
    end: float
    words: list[tuple[str, float, float]]  # text, start, end in source time


def build_suggestions(
    segments: list[SegmentInput],
    *,
    silences_by_segment: dict[int, list[SilenceInterval]],
    profile: IntensityProfile,
    intensity: CutIntensity,
    include_silence: bool = True,
    include_fillers: bool = True,
) -> list[CutSuggestion]:
    """Produce pending suggestions; never mutates the Reel."""
    out: list[CutSuggestion] = []
    for segment in segments:
        bucket: list[CutSuggestion] = []
        if include_silence:
            silences = silences_by_segment.get(segment.index, [])
            bucket.extend(
                _silence_suggestions(segment, silences, profile=profile, intensity=intensity)
            )
        if include_fillers:
            tokens = tokens_from_words(
                [
                    (text, start, end)
                    for text, start, end in segment.words
                    if start >= segment.start - 0.02 and end <= segment.end + 0.02
                ]
            )
            bucket.extend(
                _filler_suggestions(segment, tokens, profile=profile, intensity=intensity)
            )
        bucket.sort(key=lambda s: (-s.confidence, s.region_start))
        out.extend(bucket[: profile.max_per_segment])
    return out


def _silence_suggestions(
    segment: SegmentInput,
    silences: list[SilenceInterval],
    *,
    profile: IntensityProfile,
    intensity: CutIntensity,
) -> list[CutSuggestion]:
    suggestions: list[CutSuggestion] = []
    for silence in silences:
        if silence.duration < profile.min_silence_duration:
            continue
        # Leading silence → trim start, keep natural margin before speech.
        if silence.start <= segment.start + 0.08:
            speech_start = silence.end
            new_start = min(
                speech_start - profile.keep_margin,
                segment.end - profile.min_safe_kept_duration,
            )
            new_start = max(segment.start, new_start)
            if new_start <= segment.start + 0.05:
                continue
            if segment.end - new_start < profile.min_safe_kept_duration:
                continue
            suggestions.append(
                _edge(
                    segment,
                    kind=CutSuggestionKind.trim_leading_silence,
                    intensity=intensity,
                    profile=profile,
                    region_start=segment.start,
                    region_end=silence.end,
                    new_start=new_start,
                    new_end=segment.end,
                    message=(
                        f"Silencio inicial de {silence.duration:.2f}s; se puede "
                        f"acercar el inicio dejando {profile.keep_margin:.2f}s de margen."
                    ),
                    recommendation=(
                        "Aceptar recorta el silencio de borde sin eliminar la respiración."
                    ),
                )
            )
            continue

        # Trailing silence → trim end.
        if silence.end >= segment.end - 0.08:
            speech_end = silence.start
            new_end = max(
                speech_end + profile.keep_margin,
                segment.start + profile.min_safe_kept_duration,
            )
            new_end = min(segment.end, new_end)
            if new_end >= segment.end - 0.05:
                continue
            if new_end - segment.start < profile.min_safe_kept_duration:
                continue
            suggestions.append(
                _edge(
                    segment,
                    kind=CutSuggestionKind.trim_trailing_silence,
                    intensity=intensity,
                    profile=profile,
                    region_start=silence.start,
                    region_end=segment.end,
                    new_start=segment.start,
                    new_end=new_end,
                    message=(
                        f"Silencio final de {silence.duration:.2f}s; se puede "
                        f"acortar dejando {profile.keep_margin:.2f}s de margen."
                    ),
                    recommendation=(
                        "Aceptar recorta el silencio final sin un corte seco sobre el habla."
                    ),
                )
            )
            continue

        # Internal silence / long pause → optional split with residual silence + crossfade.
        if silence.duration < profile.min_silence_duration:
            continue
        kind = (
            CutSuggestionKind.long_pause
            if silence.duration >= profile.min_long_pause
            else CutSuggestionKind.reduce_internal_silence
        )
        # Keep residual silence distributed around the join for natural breathing.
        half_residual = profile.residual_silence / 2.0
        keep_before_end = silence.start + half_residual
        keep_after_start = silence.end - half_residual
        if keep_after_start <= keep_before_end:
            mid = (silence.start + silence.end) / 2.0
            keep_before_end = mid - profile.residual_silence / 2.0
            keep_after_start = mid + profile.residual_silence / 2.0
        # Also respect speech margins relative to surrounding audio edges.
        keep_before_end = max(keep_before_end, segment.start + profile.keep_margin)
        keep_after_start = min(keep_after_start, segment.end - profile.keep_margin)
        left_len = keep_before_end - segment.start
        right_len = segment.end - keep_after_start
        if left_len < profile.min_safe_kept_duration or right_len < profile.min_safe_kept_duration:
            continue
        removed = max(0.0, keep_after_start - keep_before_end)
        if removed < 0.15:
            continue
        suggestions.append(
            CutSuggestion(
                id=uuid.uuid4(),
                kind=kind,
                intensity=intensity,
                status=CutSuggestionStatus.pending,
                segment_id=segment.index,
                segment_uuid=segment.uuid,
                region_start=silence.start,
                region_end=silence.end,
                message=_silence_cut_message(
                    kind, silence.duration, removed, profile.residual_silence
                ),
                recommendation=(
                    "Al aceptar se parte el fragmento, se aplica un fundido corto y "
                    "no se elimina toda la respiración."
                ),
                confidence=0.75 if kind == CutSuggestionKind.long_pause else 0.65,
                requires_review=False,
                split=True,
                keep_before_end=keep_before_end,
                keep_after_start=keep_after_start,
                apply_crossfade_ms=profile.crossfade_ms,
                keep_margin=profile.keep_margin,
            )
        )
    return suggestions


def _filler_suggestions(
    segment: SegmentInput,
    tokens: list[TimedToken],
    *,
    profile: IntensityProfile,
    intensity: CutIntensity,
) -> list[CutSuggestion]:
    suggestions: list[CutSuggestion] = []
    for hit in detect_filler_hits(
        tokens,
        profile=profile,
        segment_start=segment.start,
        segment_end=segment.end,
    ):
        kind = {
            "filler_word": CutSuggestionKind.filler_word,
            "immediate_repetition": CutSuggestionKind.immediate_repetition,
            "false_start": CutSuggestionKind.false_start,
        }[hit.kind]
        # Expand removal slightly but keep speech margins outside the hit.
        cut_start = max(segment.start, hit.start - 0.02)
        cut_end = min(segment.end, hit.end + 0.02)
        keep_before_end = max(segment.start, cut_start - profile.keep_margin * 0.25)
        keep_after_start = min(segment.end, cut_end + profile.keep_margin * 0.25)
        # Prefer edge trim when the hit sits at a border.
        if cut_start <= segment.start + profile.keep_margin:
            new_start = min(segment.end - profile.min_safe_kept_duration, cut_end)
            new_start = max(segment.start, new_start)
            if new_start - segment.start < 0.08:
                continue
            suggestions.append(
                _edge(
                    segment,
                    kind=kind,
                    intensity=intensity,
                    profile=profile,
                    region_start=cut_start,
                    region_end=cut_end,
                    new_start=new_start,
                    new_end=segment.end,
                    message=hit.message,
                    recommendation=(
                        "Revisa el contexto: no se eliminan palabras con posible "
                        "sentido real sin tu aprobación."
                    ),
                    matched_text=hit.matched_text,
                    confidence=hit.confidence,
                    requires_review=hit.requires_review,
                )
            )
            continue
        if cut_end >= segment.end - profile.keep_margin:
            new_end = max(segment.start + profile.min_safe_kept_duration, cut_start)
            new_end = min(segment.end, new_end)
            if segment.end - new_end < 0.08:
                continue
            suggestions.append(
                _edge(
                    segment,
                    kind=kind,
                    intensity=intensity,
                    profile=profile,
                    region_start=cut_start,
                    region_end=cut_end,
                    new_start=segment.start,
                    new_end=new_end,
                    message=hit.message,
                    recommendation=(
                        "Revisa el contexto: no se eliminan palabras con posible "
                        "sentido real sin tu aprobación."
                    ),
                    matched_text=hit.matched_text,
                    confidence=hit.confidence,
                    requires_review=hit.requires_review,
                )
            )
            continue

        left_len = keep_before_end - segment.start
        right_len = segment.end - keep_after_start
        if left_len < profile.min_safe_kept_duration or right_len < profile.min_safe_kept_duration:
            continue
        suggestions.append(
            CutSuggestion(
                id=uuid.uuid4(),
                kind=kind,
                intensity=intensity,
                status=CutSuggestionStatus.pending,
                segment_id=segment.index,
                segment_uuid=segment.uuid,
                region_start=cut_start,
                region_end=cut_end,
                message=hit.message,
                recommendation=(
                    "Al aceptar se parte el fragmento con un crossfade corto. "
                    "Las muletillas dudosas quedan marcadas para revisión."
                ),
                matched_text=hit.matched_text,
                confidence=hit.confidence,
                requires_review=hit.requires_review,
                split=True,
                keep_before_end=keep_before_end,
                keep_after_start=keep_after_start,
                apply_crossfade_ms=profile.crossfade_ms,
                keep_margin=profile.keep_margin,
            )
        )
    return suggestions


def _edge(
    segment: SegmentInput,
    *,
    kind: CutSuggestionKind,
    intensity: CutIntensity,
    profile: IntensityProfile,
    region_start: float,
    region_end: float,
    new_start: float,
    new_end: float,
    message: str,
    recommendation: str,
    matched_text: str | None = None,
    confidence: float = 0.7,
    requires_review: bool = False,
) -> CutSuggestion:
    return CutSuggestion(
        id=uuid.uuid4(),
        kind=kind,
        intensity=intensity,
        status=CutSuggestionStatus.pending,
        segment_id=segment.index,
        segment_uuid=segment.uuid,
        region_start=region_start,
        region_end=region_end,
        message=message,
        recommendation=recommendation,
        matched_text=matched_text,
        confidence=confidence,
        requires_review=requires_review,
        new_start=new_start,
        new_end=new_end,
        split=False,
        apply_crossfade_ms=profile.crossfade_ms,
        keep_margin=profile.keep_margin,
    )
