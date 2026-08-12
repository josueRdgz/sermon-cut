"""Rank sermon lines so Highlights keeps quotes and applications when compacting."""

from __future__ import annotations

import re

from app.services.ai.schemas import TranscriptSegmentInput

_FOLD = str.maketrans("áéíóúüñÁÉÍÓÚÜÑ", "aeiouunAEIOUUN")

_APPLICATION = re.compile(
    r"\b(por eso|por lo tanto|entonces|hoy|usted|ustedes|hermano|hermana|"
    r"debemos|tenemos que|hay que|no podemos|eso significa|en la practica|"
    r"la aplicacion|si usted|si tu|arrepient|cree(?:n|a|amos)?|confia|"
    r"obedece|perdona|vive(?:n)?|camina|decide|elige|no se trata|"
    r"esta semana|en tu casa|en tu trabajo|cuando salga[s]?|"
    r"la invitacion|ponte de pie|ven a cristo|aqui esta el punto|"
    r"esto es lo que|la pregunta es|fijate|te voy a decir)\b",
    re.IGNORECASE,
)
_QUOTABLE = re.compile(
    r"\b(cristo|jesus|evangelio|gracia|cruz|sangre|perdon|salvacion|"
    r"esperanza|fe|amor|santidad|palabra de dios|reino|verdad|"
    r"arrepentimiento|justificacion|misericordia)\b",
    re.IGNORECASE,
)
_SCRIPTURE = re.compile(
    r"\b(genesis|exodo|levitico|numeros|deuteronomio|salmo[s]?|proverbios|"
    r"isaias|jeremias|mateo|marcos|lucas|juan|hechos|romanos|corintios|"
    r"galatas|efesios|filipenses|colosenses|tesalonicenses|timoteo|"
    r"hebreos|santiago|pedro|apocalipsis|versiculo)\b",
    re.IGNORECASE,
)
_FILLER = re.compile(
    r"\b(bienvenidos|anuncio[s]?|ofrenda|diezmo|alabanza|cumpleanos|"
    r"actividad|reunion|quiero comenzar|vamos a ver|el siguiente punto|"
    r"como les decia|pasemos ahora)\b",
    re.IGNORECASE,
)
_CONTRAST = re.compile(
    r"\bno (?:es|son|estamos|se trata).{0,48}\b(?:es|son|estamos|se trata)\b",
    re.IGNORECASE,
)


def score_line(text: str) -> int:
    """Higher scores are more likely to be a memorable phrase or application."""
    folded = text.translate(_FOLD)
    words = [part for part in re.split(r"\s+", folded.strip()) if part]
    if not words:
        return -4
    score = 0
    count = len(words)
    if 8 <= count <= 36:
        score += 2
    elif 37 <= count <= 80:
        score += 1
    elif count < 5:
        score -= 2
    if _APPLICATION.search(folded):
        score += 4
    if _QUOTABLE.search(folded):
        score += 2
    if _SCRIPTURE.search(folded):
        score += 1
    if "?" in text:
        score += 2
    if _CONTRAST.search(folded):
        score += 2
    if _FILLER.search(folded):
        score -= 3
    return score


def compact_transcript_lines(
    segments: list[TranscriptSegmentInput],
    *,
    char_budget: int,
) -> list[str]:
    """Merge Whisper crumbs, then keep coverage plus the strongest lines."""
    merged = _merge_segments(segments)
    if not merged:
        return []
    scored = [(start, end, text, score_line(text)) for start, end, text in merged]
    formatted = [_format_line(start, end, text, score) for start, end, text, score in scored]
    total = sum(len(line) + 1 for line in formatted)
    if total <= char_budget or len(formatted) <= 3:
        return formatted

    chosen = _select_indexes(scored, formatted, char_budget)
    selected = [formatted[index] for index in sorted(chosen)]
    if len(chosen) < len(formatted):
        selected.insert(
            1,
            "(Se omitieron líneas intermedias por longitud; respeta los tiempos "
            "mostrados. Las líneas con ★ son frases o aplicaciones fuertes.)",
        )
    return selected


def _merge_segments(segments: list[TranscriptSegmentInput]) -> list[tuple[float, float, str]]:
    merged: list[tuple[float, float, str]] = []
    start: float | None = None
    end = 0.0
    parts: list[str] = []

    def flush() -> None:
        nonlocal start, parts
        if start is None or not parts:
            return
        merged.append((start, end, " ".join(parts).strip()))
        start = None
        parts = []

    for item in segments:
        text = item.text.strip()
        if not text:
            continue
        candidate = " ".join([*parts, text]).strip() if parts else text
        if start is None:
            start, end, parts = item.start, item.end, [text]
            continue
        close_enough = item.start - end <= 1.5
        if close_enough and len(candidate) <= 420:
            end = item.end
            parts.append(text)
        else:
            flush()
            start, end, parts = item.start, item.end, [text]
    flush()
    return merged


def _format_line(start: float, end: float, text: str, score: int) -> str:
    mark = "★ " if score >= 5 else ""
    return f"[{start:.2f}-{end:.2f}] {mark}{text}"


def _select_indexes(
    scored: list[tuple[float, float, str, int]],
    formatted: list[str],
    char_budget: int,
) -> set[int]:
    count = len(formatted)
    average = max(80, sum(len(line) + 1 for line in formatted) // count)
    skeleton_slots = max(3, min(count, (char_budget * 35 // 100) // average))
    chosen = {0, count - 1}
    if skeleton_slots > 2:
        for step in range(1, skeleton_slots - 1):
            chosen.add(round(step * (count - 1) / (skeleton_slots - 1)))

    def used() -> int:
        return sum(len(formatted[index]) + 1 for index in chosen)

    ranked = sorted(range(count), key=lambda index: (-scored[index][3], index))
    for index in ranked:
        if index in chosen:
            continue
        cost = len(formatted[index]) + 1
        if used() + cost > char_budget:
            continue
        chosen.add(index)
    return chosen
