"""Validate and snap AI-suggested clips against the real transcript.

Gemini (or any provider) may drift on timestamps or invent wording. This module
is the gate: every accepted candidate must have evidence in the transcript,
intervals inside the video, and no inverted / overlapping segments.
"""

from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass, field

from app.services.ai.schemas import (
    AnalysisResponse,
    SuggestedClip,
    TranscriptSegmentInput,
    TranscriptWordInput,
)

_WORD_RE = re.compile(r"[0-9A-Za-zÁÉÍÓÚÜÑáéíóúüñ]+", re.UNICODE)
# Keep a few milliseconds of real speech around word snaps so analysis cuts
# do not clip consonants. Never stretch or rewrite samples.
_AUDIO_HANDLE_IN_SECONDS = 0.04
_AUDIO_HANDLE_OUT_SECONDS = 0.08


@dataclass(frozen=True)
class ValidatedSegment:
    start: float
    end: float
    exact_text: str
    reason: str
    match_ratio: float
    snapped: bool


@dataclass(frozen=True)
class ValidatedClip:
    title: str
    hook: str
    summary: str
    editorial_score: float
    segments: list[ValidatedSegment]
    joined_script: str
    removed_context_warning: str | None
    caption: str
    hashtags: list[str]
    suggested_titles: dict[str, str]
    thumbnail_text: str
    keywords: list[str]
    warnings: list[str] = field(default_factory=list)
    confidence: float = 1.0


@dataclass(frozen=True)
class ValidationReport:
    accepted: list[ValidatedClip]
    rejected: list[str]


def normalize_text(value: str) -> str:
    """Lowercase, strip accents and punctuation for fuzzy evidence checks."""
    folded = unicodedata.normalize("NFKD", value)
    ascii_ish = "".join(ch for ch in folded if not unicodedata.combining(ch))
    tokens = _WORD_RE.findall(ascii_ish.lower())
    return " ".join(tokens)


def _collect_words(
    segments: list[TranscriptSegmentInput],
) -> list[TranscriptWordInput]:
    words: list[TranscriptWordInput] = []
    for segment in segments:
        if segment.words:
            words.extend(segment.words)
        else:
            # Approximate one "word" spanning the whole segment when no
            # word-level timestamps exist.
            words.append(
                TranscriptWordInput(start=segment.start, end=segment.end, text=segment.text)
            )
    return words


def _window_text(
    segments: list[TranscriptSegmentInput],
    start: float,
    end: float,
    *,
    pad: float = 0.75,
) -> str:
    pieces: list[str] = []
    lo = start - pad
    hi = end + pad
    for segment in segments:
        if segment.end < lo or segment.start > hi:
            continue
        pieces.append(segment.text)
    return " ".join(pieces)


def _match_ratio(exact: str, haystack: str) -> float:
    needle = normalize_text(exact)
    hay = normalize_text(haystack)
    if not needle:
        return 0.0
    if needle in hay:
        return 1.0
    # Token overlap as a soft fallback for minor punctuation / casing drift.
    needle_tokens = needle.split()
    hay_tokens = set(hay.split())
    if not needle_tokens:
        return 0.0
    hits = sum(1 for token in needle_tokens if token in hay_tokens)
    return hits / len(needle_tokens)


def snap_to_words(
    start: float,
    end: float,
    words: list[TranscriptWordInput],
) -> tuple[float, float, bool]:
    """Expand/contract the interval to the nearest overlapping word edges."""
    if not words or end <= start:
        return start, end, False

    overlapping = [w for w in words if w.end >= start - 0.05 and w.start <= end + 0.05]
    if not overlapping:
        # Nearest word by midpoint distance.
        mid = (start + end) / 2.0
        nearest = min(words, key=lambda w: abs(((w.start + w.end) / 2.0) - mid))
        return nearest.start, nearest.end, True

    snapped_start = overlapping[0].start
    snapped_end = overlapping[-1].end
    changed = abs(snapped_start - start) > 0.05 or abs(snapped_end - end) > 0.05
    return snapped_start, snapped_end, changed


def validate_analysis_response(
    response: AnalysisResponse,
    *,
    segments: list[TranscriptSegmentInput],
    video_duration: float,
    min_segment_seconds: float = 0.1,
    max_segments_per_clip: int | None = None,
    merge_gap_seconds: float = 0.0,
    min_clip_seconds: float | None = None,
    max_clip_seconds: float | None = None,
    min_match_ratio: float = 0.72,
) -> ValidationReport:
    """Reject invented text and illegal intervals; snap survivors to words."""
    words = _collect_words(segments)
    accepted: list[ValidatedClip] = []
    rejected: list[str] = []

    for index, clip in enumerate(response.clips):
        try:
            validated = _validate_clip(
                clip,
                segments=segments,
                words=words,
                video_duration=video_duration,
                min_segment_seconds=min_segment_seconds,
                max_segments_per_clip=max_segments_per_clip,
                merge_gap_seconds=merge_gap_seconds,
                min_clip_seconds=min_clip_seconds,
                max_clip_seconds=max_clip_seconds,
                min_match_ratio=min_match_ratio,
            )
        except ValueError as exc:
            rejected.append(f"Clip {index + 1} ({clip.title!r}): {exc}")
            continue
        accepted.append(validated)

    return ValidationReport(accepted=accepted, rejected=rejected)


def _validate_clip(
    clip: SuggestedClip,
    *,
    segments: list[TranscriptSegmentInput],
    words: list[TranscriptWordInput],
    video_duration: float,
    min_segment_seconds: float,
    max_segments_per_clip: int | None,
    merge_gap_seconds: float,
    min_clip_seconds: float | None,
    max_clip_seconds: float | None,
    min_match_ratio: float,
) -> ValidatedClip:
    if not clip.segments:
        raise ValueError("empty segments")

    validated_segments: list[ValidatedSegment] = []
    warnings: list[str] = []
    ratios: list[float] = []

    for raw in clip.segments:
        start, end = float(raw.start), float(raw.end)
        if end <= start:
            raise ValueError(f"inverted interval {start}–{end}")
        if start < -0.05 or end > video_duration + 0.25:
            raise ValueError(f"interval outside the video ({start}–{end})")
        snapped_start, snapped_end, snapped = snap_to_words(start, end, words)
        if snapped_end <= snapped_start:
            raise ValueError("snapped interval collapsed")

        haystack = _window_text(segments, snapped_start, snapped_end)
        ratio = _match_ratio(raw.exact_text, haystack)
        if ratio < min_match_ratio:
            raise ValueError(f"exact_text not found in the indicated interval (match={ratio:.2f})")
        if ratio < 0.9:
            warnings.append(
                f"Baja coincidencia de texto ({ratio:.0%}) en "
                f"{snapped_start:.1f}–{snapped_end:.1f}s."
            )
        if snapped:
            warnings.append(
                f"Tiempos ajustados a límites de palabra: "
                f"{start:.2f}–{end:.2f} → {snapped_start:.2f}–{snapped_end:.2f}."
            )

        ratios.append(ratio)
        validated_segments.append(
            ValidatedSegment(
                start=round(snapped_start, 3),
                end=round(snapped_end, 3),
                exact_text=raw.exact_text.strip(),
                reason=raw.reason.strip(),
                match_ratio=ratio,
                snapped=snapped,
            )
        )

    # Reject overlapping source windows inside the same Reel.
    ordered = sorted(validated_segments, key=lambda s: s.start)
    for prev, nxt in zip(ordered, ordered[1:], strict=False):
        if nxt.start < prev.end - 0.05:
            raise ValueError(
                f"overlapping segments {prev.start}–{prev.end} and {nxt.start}–{nxt.end}"
            )

    ordered = _merge_nearby_segments(ordered, max(0.0, merge_gap_seconds))
    if max_segments_per_clip is not None and len(ordered) > max_segments_per_clip:
        raise ValueError(
            f"too many segments ({len(ordered)}; maximum {max_segments_per_clip})"
        )
    for segment in ordered:
        duration = segment.end - segment.start
        if duration < min_segment_seconds:
            raise ValueError(
                f"segment shorter than {min_segment_seconds}s "
                f"({segment.start}–{segment.end})"
            )

    total_duration = sum(segment.end - segment.start for segment in ordered)
    if min_clip_seconds is not None and total_duration < min_clip_seconds:
        raise ValueError(
            f"clip shorter than {min_clip_seconds}s ({total_duration:.2f}s)"
        )
    if max_clip_seconds is not None and total_duration > max_clip_seconds:
        raise ValueError(
            f"clip longer than {max_clip_seconds}s ({total_duration:.2f}s)"
        )
    ordered = _apply_audio_handles(ordered, video_duration)

    confidence = sum(ratios) / len(ratios) if ratios else 0.0
    if confidence < 0.85:
        warnings.append(
            f"Confianza editorial baja ({confidence:.0%}): revisa el candidato antes de aceptarlo."
        )
    if clip.removed_context_warning:
        warnings.append(clip.removed_context_warning)

    joined = clip.joined_script.strip() or " ".join(s.exact_text for s in ordered)
    return ValidatedClip(
        title=clip.title.strip() or "Reel sugerido",
        hook=clip.hook.strip(),
        summary=clip.summary.strip(),
        editorial_score=clip.editorial_score,
        segments=ordered,
        joined_script=joined,
        removed_context_warning=clip.removed_context_warning,
        caption=clip.caption.strip(),
        hashtags=[tag.strip() for tag in clip.hashtags if tag.strip()][:20],
        suggested_titles=(
            clip.suggested_titles.model_dump(mode="json")
            if clip.suggested_titles is not None
            else {
                "recommended": clip.title.strip(),
                "direct": clip.title.strip(),
                "emotional": clip.title.strip(),
                "biblical": clip.title.strip(),
                "search_focused": clip.title.strip(),
            }
        ),
        thumbnail_text=clip.thumbnail_text.strip(),
        keywords=[item.strip() for item in clip.keywords if item.strip()][:20],
        warnings=warnings,
        confidence=round(confidence, 3),
    )


def _merge_nearby_segments(
    segments: list[ValidatedSegment],
    max_gap_seconds: float,
) -> list[ValidatedSegment]:
    """Join consecutive suggestions so subtitle boundaries do not become cuts."""
    if not segments:
        return []

    merged = [segments[0]]
    for current in segments[1:]:
        previous = merged[-1]
        gap = current.start - previous.end
        if gap > max_gap_seconds:
            merged.append(current)
            continue

        reasons = [value for value in (previous.reason, current.reason) if value]
        merged[-1] = ValidatedSegment(
            start=previous.start,
            end=current.end,
            exact_text=f"{previous.exact_text} {current.exact_text}".strip(),
            reason=" ".join(dict.fromkeys(reasons)),
            match_ratio=min(previous.match_ratio, current.match_ratio),
            snapped=previous.snapped or current.snapped,
        )
    return merged


def _apply_audio_handles(
    segments: list[ValidatedSegment],
    video_duration: float,
) -> list[ValidatedSegment]:
    """Pad word-snapped edges with unused neighbouring audio, never overlapping."""
    if not segments:
        return []
    padded: list[ValidatedSegment] = []
    for index, segment in enumerate(segments):
        previous_end = padded[-1].end if padded else 0.0
        next_start = segments[index + 1].start if index + 1 < len(segments) else video_duration
        room_before = max(0.0, segment.start - previous_end)
        room_after = max(0.0, next_start - segment.end)
        start = max(0.0, segment.start - min(_AUDIO_HANDLE_IN_SECONDS, room_before))
        end = min(video_duration, segment.end + min(_AUDIO_HANDLE_OUT_SECONDS, room_after))
        if end <= start:
            padded.append(segment)
            continue
        padded.append(
            ValidatedSegment(
                start=round(start, 3),
                end=round(end, 3),
                exact_text=segment.exact_text,
                reason=segment.reason,
                match_ratio=segment.match_ratio,
                snapped=segment.snapped,
            )
        )
    return padded
