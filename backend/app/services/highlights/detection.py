"""Local, evidence-based sermon boundary detection.

The detector intentionally reports uncertainty. It combines speech continuity,
long non-speech gaps, transcript density and weak lexical boundary signals; no
single phrase can decide the result.
"""

from __future__ import annotations

import re
from dataclasses import dataclass

from app.models.transcript import Transcript

_OPENING = re.compile(
    r"\b(abramos|vamos a la palabra|mensaje de hoy|tema de hoy|predicaci[oó]n|"
    r"texto b[ií]blico|acompa[ñn]e(?:n)?me)\b",
    re.IGNORECASE,
)
_CLOSING = re.compile(
    r"\b(oremos|vamos a orar|inclinen sus rostros|conclu(?:yo|imos)|"
    r"para terminar|dios les bendiga)\b",
    re.IGNORECASE,
)
_NON_SERMON = re.compile(
    r"\b(anuncio|bienvenidos|ofrenda|diezmo|alabanza|coro|cumplea[ñn]os|"
    r"actividad|reuni[oó]n de)\b",
    re.IGNORECASE,
)


@dataclass(frozen=True)
class TimedText:
    start: float
    end: float
    text: str

    @property
    def duration(self) -> float:
        return max(0.0, self.end - self.start)


@dataclass(frozen=True)
class SermonDetection:
    start: float
    end: float
    confidence: float
    method: str
    notes: str

    @property
    def requires_manual_range(self) -> bool:
        return self.confidence < 0.68


def detect_sermon_range(transcript: Transcript, video_duration: float) -> SermonDetection:
    """Return the most probable sustained sermon block on the source clock."""
    timed = [
        TimedText(float(item.start_seconds), float(item.end_seconds), item.text or "")
        for item in sorted(transcript.segments, key=lambda segment: segment.order)
        if item.start_seconds is not None
        and item.end_seconds is not None
        and item.end_seconds > item.start_seconds
    ]
    if not timed:
        raise ValueError("La transcripción no contiene segmentos sincronizados.")

    duration = max(video_duration, timed[-1].end)
    speech_span = timed[-1].end - timed[0].start
    speech_seconds = sum(item.duration for item in timed)
    occupancy = speech_seconds / max(speech_span, 1.0)

    # A source that begins and ends with sustained speech is probably sermon-only.
    starts_early = timed[0].start <= min(90.0, duration * 0.08)
    ends_late = duration - timed[-1].end <= min(120.0, duration * 0.10)
    if starts_early and ends_late and occupancy >= 0.45 and not _NON_SERMON.search(
        " ".join(item.text for item in timed[:5])
    ):
        confidence = min(0.94, 0.72 + occupancy * 0.22)
        return SermonDetection(
            start=max(0.0, timed[0].start - 0.5),
            end=min(duration, timed[-1].end + 0.5),
            confidence=round(confidence, 3),
            method="speech_continuity",
            notes=(
                "El archivo presenta voz continua desde el inicio hasta el cierre; "
                "se clasificó como predicación completa."
            ),
        )

    clusters = _speech_clusters(timed)
    scored = [(_score_cluster(cluster, duration), cluster) for cluster in clusters]
    scored.sort(key=lambda item: item[0], reverse=True)
    best_score, best = scored[0]
    runner_up = scored[1][0] if len(scored) > 1 else 0.0

    start_index = 0
    end_index = len(best) - 1
    for index, item in enumerate(best[: min(8, len(best))]):
        if _OPENING.search(item.text):
            start_index = max(0, index - 1)
            break
    for reverse_index, item in enumerate(reversed(best[-min(8, len(best)) :])):
        if _CLOSING.search(item.text):
            end_index = min(len(best) - 1, len(best) - reverse_index - 1)
            break

    selected = best[start_index : end_index + 1]
    margin = max(0.0, min(1.0, best_score - runner_up))
    coverage = (selected[-1].end - selected[0].start) / max(duration, 1.0)
    confidence = 0.48 + min(0.24, coverage * 0.35) + min(0.18, margin * 0.25)
    if any(_OPENING.search(item.text) for item in selected[:8]):
        confidence += 0.06
    if any(_CLOSING.search(item.text) for item in selected[-8:]):
        confidence += 0.04
    non_sermon_ratio = sum(bool(_NON_SERMON.search(item.text)) for item in selected) / max(
        len(selected), 1
    )
    if non_sermon_ratio >= 0.45:
        confidence = min(confidence, 0.46)
    if selected[-1].end - selected[0].start < min(300.0, duration * 0.18):
        confidence = min(confidence, 0.62)
    confidence = round(min(0.96, confidence), 3)

    return SermonDetection(
        start=max(0.0, selected[0].start - 0.75),
        end=min(duration, selected[-1].end + 0.75),
        confidence=confidence,
        method="transcript_gaps_and_continuity",
        notes=(
            "Límites estimados con continuidad de voz, densidad temática, pausas prolongadas "
            "y señales lingüísticas débiles. Revise manualmente cuando la confianza sea baja."
        ),
    )


def _speech_clusters(
    items: list[TimedText],
    *,
    split_gap_seconds: float = 75.0,
) -> list[list[TimedText]]:
    clusters: list[list[TimedText]] = [[items[0]]]
    for item in items[1:]:
        previous = clusters[-1][-1]
        if item.start - previous.end >= split_gap_seconds:
            clusters.append([item])
        else:
            clusters[-1].append(item)
    return clusters


def _score_cluster(cluster: list[TimedText], video_duration: float) -> float:
    span = max(1.0, cluster[-1].end - cluster[0].start)
    speech = sum(item.duration for item in cluster)
    density = min(1.0, speech / span)
    relative_length = min(1.0, span / max(video_duration * 0.45, 1.0))
    words = sum(len(item.text.split()) for item in cluster)
    word_density = min(1.0, words / max(span * 1.2, 1.0))
    non_sermon_hits = sum(1 for item in cluster if _NON_SERMON.search(item.text))
    penalty = min(0.35, non_sermon_hits / max(len(cluster), 1))
    return 0.46 * relative_length + 0.32 * density + 0.22 * word_density - penalty
