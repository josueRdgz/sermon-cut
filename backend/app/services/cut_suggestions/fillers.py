"""Lexical hesitation / filler heuristics for technical cut suggestions.

Never auto-deletes. Suggestions that might carry real meaning are flagged with
``requires_review=True`` so the preacher's wording is preserved unless the user
explicitly accepts.
"""

from __future__ import annotations

import re
from dataclasses import dataclass

from app.services.cut_suggestions.intensity import IntensityProfile

_WORD_RE = re.compile(r"[0-9A-Za-zÁÉÍÓÚÜÑáéíóúüñ']+", re.UNICODE)

# Safe standalone vocalizations — rarely doctrinal content on their own.
_SAFE_FILLERS = frozenset(
    {
        "eh",
        "ehh",
        "ehhh",
        "ehm",
        "emm",
        "mm",
        "mmm",
        "hmm",
        "ah",
        "ahh",
    }
)

# Can be meaningful ("este punto", "pues bien"); only suggest with hesitation cues.
_CONTEXTUAL_FILLERS = frozenset({"este", "pues"})

# Immediate false-start patterns: truncated token then fuller restart.
_FALSE_START_PREFIX_MIN = 2


@dataclass(frozen=True)
class TimedToken:
    index: int
    text: str
    normalized: str
    start: float
    end: float


@dataclass(frozen=True)
class FillerHit:
    kind: str  # filler_word | immediate_repetition | false_start
    start: float
    end: float
    matched_text: str
    confidence: float
    requires_review: bool
    message: str


def normalize_token(text: str) -> str:
    parts = _WORD_RE.findall(text.lower())
    return parts[0] if parts else ""


def tokens_from_words(
    words: list[tuple[str, float, float]],
) -> list[TimedToken]:
    tokens: list[TimedToken] = []
    for index, (text, start, end) in enumerate(words):
        norm = normalize_token(text)
        if not norm:
            continue
        tokens.append(
            TimedToken(
                index=index,
                text=text,
                normalized=norm,
                start=start,
                end=end,
            )
        )
    return tokens


def detect_filler_hits(
    tokens: list[TimedToken],
    *,
    profile: IntensityProfile,
    segment_start: float,
    segment_end: float,
) -> list[FillerHit]:
    """Find candidate hesitations inside one Reel window."""
    if not profile.suggest_fillers or not tokens:
        return []

    hits: list[FillerHit] = []
    hits.extend(
        _safe_and_contextual_fillers(
            tokens, profile=profile, segment_start=segment_start, segment_end=segment_end
        )
    )
    hits.extend(_immediate_repetitions(tokens, profile=profile))
    hits.extend(_false_starts(tokens, profile=profile))
    return _dedupe(hits)


def _pause_before(tokens: list[TimedToken], index: int, segment_start: float) -> float:
    if index <= 0:
        return max(0.0, tokens[0].start - segment_start)
    return max(0.0, tokens[index].start - tokens[index - 1].end)


def _pause_after(tokens: list[TimedToken], index: int, segment_end: float) -> float:
    if index >= len(tokens) - 1:
        return max(0.0, segment_end - tokens[-1].end)
    return max(0.0, tokens[index + 1].start - tokens[index].end)


def _safe_and_contextual_fillers(
    tokens: list[TimedToken],
    *,
    profile: IntensityProfile,
    segment_start: float,
    segment_end: float,
) -> list[FillerHit]:
    hits: list[FillerHit] = []
    for index, token in enumerate(tokens):
        duration = token.end - token.start
        if duration < profile.min_filler_duration:
            continue
        before = _pause_before(tokens, index, segment_start)
        after = _pause_after(tokens, index, segment_end)
        near_pause = max(before, after) >= profile.filler_pause_around

        if token.normalized in _SAFE_FILLERS and near_pause:
            hits.append(
                FillerHit(
                    kind="filler_word",
                    start=token.start,
                    end=token.end,
                    matched_text=token.text,
                    confidence=0.85 if near_pause else 0.55,
                    requires_review=False,
                    message=(
                        f"Posible muletilla «{token.text}» con pausa cercana; "
                        "no se elimina sola — revisa antes de aceptar."
                    ),
                )
            )
            continue

        if (
            profile.allow_contextual_fillers
            and token.normalized in _CONTEXTUAL_FILLERS
            and near_pause
            and not _looks_meaningful_este_pues(tokens, index)
        ):
            hits.append(
                FillerHit(
                    kind="filler_word",
                    start=token.start,
                    end=token.end,
                    matched_text=token.text,
                    confidence=0.55,
                    requires_review=True,
                    message=(
                        f"«{token.text}» podría ser muletilla, pero también puede "
                        "tener sentido real. Requiere revisión manual."
                    ),
                )
            )
    return hits


def _looks_meaningful_este_pues(tokens: list[TimedToken], index: int) -> bool:
    """Guard doctrinal / referential uses: «este punto», «pues bien», etc."""
    nxt = tokens[index + 1].normalized if index + 1 < len(tokens) else ""
    meaningful_followers = {
        "punto",
        "pasaje",
        "texto",
        "versículo",
        "versiculo",
        "tema",
        "aspecto",
        "bien",
        "entonces",
        "hermanos",
        "amigo",
        "dios",
        "señor",
        "senor",
        "cristo",
    }
    if nxt in meaningful_followers:
        return True
    # «este» + adjective/noun longer than filler typically → keep.
    if tokens[index].normalized == "este" and nxt and len(nxt) >= 5:
        return True
    return False


def _immediate_repetitions(
    tokens: list[TimedToken],
    *,
    profile: IntensityProfile,
) -> list[FillerHit]:
    hits: list[FillerHit] = []
    for index in range(1, len(tokens)):
        prev = tokens[index - 1]
        cur = tokens[index]
        if prev.normalized != cur.normalized:
            continue
        gap = cur.start - prev.end
        if gap > 0.55:
            continue
        # Keep the clearer (longer) instance; suggest removing the first stutter.
        remove = prev if (prev.end - prev.start) <= (cur.end - cur.start) else cur
        hits.append(
            FillerHit(
                kind="immediate_repetition",
                start=remove.start,
                end=remove.end,
                matched_text=f"{prev.text} {cur.text}",
                confidence=0.8,
                requires_review=True,
                message=(
                    f"Repetición inmediata «{prev.text} {cur.text}». "
                    "Se sugiere quitar solo la tartamudez, no ambas."
                ),
            )
        )
    return hits


def _false_starts(
    tokens: list[TimedToken],
    *,
    profile: IntensityProfile,
) -> list[FillerHit]:
    hits: list[FillerHit] = []
    for index in range(len(tokens) - 1):
        first = tokens[index]
        second = tokens[index + 1]
        if len(first.normalized) < _FALSE_START_PREFIX_MIN:
            continue
        if second.normalized == first.normalized:
            continue
        if not second.normalized.startswith(first.normalized):
            continue
        if len(second.normalized) < len(first.normalized) + 2:
            continue
        gap = second.start - first.end
        if gap > 0.7:
            continue
        hits.append(
            FillerHit(
                kind="false_start",
                start=first.start,
                end=first.end,
                matched_text=f"{first.text} → {second.text}",
                confidence=0.7,
                requires_review=True,
                message=(
                    f"Posible falso comienzo «{first.text}» corregido por "
                    f"«{second.text}». No se aplica solo."
                ),
            )
        )
    return hits


def _dedupe(hits: list[FillerHit]) -> list[FillerHit]:
    ordered = sorted(hits, key=lambda h: (h.start, h.end, h.kind))
    kept: list[FillerHit] = []
    for hit in ordered:
        if kept and abs(kept[-1].start - hit.start) < 0.05 and kept[-1].kind == hit.kind:
            continue
        kept.append(hit)
    return kept
