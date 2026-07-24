"""Deterministic join-coherence rules for multi-segment Reels.

These checks do not call any model: they inspect the ordered windows, the
transcript around each cut, and simple lexical cues that often make a join
misleading when non-consecutive fragments are concatenated.
"""

from __future__ import annotations

import re
from dataclasses import dataclass

from app.schemas.coherence import CoherenceIssue, CoherenceSeverity

_WORD_RE = re.compile(r"[0-9A-Za-zÁÉÍÓÚÜÑáéíóúüñ']+", re.UNICODE)

# Openers that usually need the preceding clause.
_DANGLING_STARTERS: tuple[str, ...] = (
    "pero",
    "sin embargo",
    "entonces",
    "por eso",
    "por lo tanto",
    "por tanto",
    "así que",
    "de modo que",
    "como dije",
    "como dije anteriormente",
    "como ya dije",
    "como mencioné",
    "además",
    "asimismo",
    "en cambio",
    "no obstante",
)

_INCOMPLETE_ENDINGS: tuple[str, ...] = (
    "y",
    "o",
    "pero",
    "porque",
    "aunque",
    "si",
    "cuando",
    "donde",
    "que",
    "de",
    "en",
    "con",
    "para",
    "sin",
    "como",
)

_DANGLING_REFERENCES: tuple[str, ...] = (
    "este punto",
    "ese punto",
    "aquel punto",
    "lo anterior",
    "lo dicho",
    "el segundo aspecto",
    "el primer aspecto",
    "el tercer aspecto",
    "el siguiente punto",
    "como vimos",
    "como hemos visto",
    "esta idea",
    "esa idea",
    "este tema",
)

_PRONOUN_OPENERS: tuple[str, ...] = (
    "él",
    "ella",
    "ellos",
    "ellas",
    "esto",
    "eso",
    "aquello",
    "este",
    "esta",
    "estos",
    "estas",
    "ese",
    "esa",
    "esos",
    "esas",
    "le",
    "les",
    "lo",
    "la",
)


@dataclass(frozen=True)
class SegmentView:
    """Minimal view of one ordered Reel window for the rule engine."""

    index: int  # 1-based
    uuid: str | None
    start: float
    end: float
    text: str
    gap_before: float  # source gap from the previous segment (0 for the first)


@dataclass(frozen=True)
class TranscriptWordView:
    start: float
    end: float
    text: str


def normalize(text: str) -> str:
    return " ".join(_WORD_RE.findall(text.lower()))


def _tokens(text: str) -> list[str]:
    return normalize(text).split()


def _starts_with_phrase(text: str, phrases: tuple[str, ...]) -> str | None:
    norm = normalize(text)
    for phrase in phrases:
        if norm == phrase or norm.startswith(phrase + " "):
            return phrase
    return None


def _ends_with_token(text: str, tokens: tuple[str, ...]) -> str | None:
    parts = _tokens(text)
    if not parts:
        return None
    last = parts[-1]
    return last if last in tokens else None


def _overlap_ratio(a: str, b: str) -> float:
    ta = set(_tokens(a))
    tb = set(_tokens(b))
    if not ta or not tb:
        return 0.0
    return len(ta & tb) / len(ta | tb)


def check_word_cuts(
    segments: list[SegmentView],
    words: list[TranscriptWordView],
) -> list[CoherenceIssue]:
    """Flag windows whose edges fall inside a spoken word."""
    if not words:
        return []
    issues: list[CoherenceIssue] = []
    for segment in segments:
        for edge_name, edge in (("inicio", segment.start), ("fin", segment.end)):
            for word in words:
                # Interior of the word, with a small tolerance for float edges.
                if word.start + 0.04 < edge < word.end - 0.04:
                    issues.append(
                        CoherenceIssue(
                            severity=CoherenceSeverity.blocked,
                            code="WORD_CUT",
                            message=(
                                f"El {edge_name} del fragmento {segment.index} corta la "
                                f"palabra «{word.text}» "
                                f"({word.start:.2f}–{word.end:.2f}s)."
                            ),
                            segment_id=segment.index,
                            recommendation=(
                                "Ajusta el borde al inicio o al final exacto de la palabra."
                            ),
                        )
                    )
                    break
    return issues


def check_dangling_starters(segments: list[SegmentView]) -> list[CoherenceIssue]:
    issues: list[CoherenceIssue] = []
    for segment in segments[1:]:
        if segment.gap_before < 0.35:
            continue
        phrase = _starts_with_phrase(segment.text, _DANGLING_STARTERS)
        if phrase is None:
            continue
        # If the previous kept fragment already ends in a compatible clause,
        # the join may still be readable — emit a softer warning only when the
        # previous ending does not supply a cause/contrast.
        previous = segments[segment.index - 2]
        prev_tokens = _tokens(previous.text)
        soft_ok = bool(prev_tokens) and prev_tokens[-1] not in {
            "y",
            "o",
            "de",
            "en",
            "con",
            "que",
        }
        issues.append(
            CoherenceIssue(
                severity=CoherenceSeverity.warning if soft_ok else CoherenceSeverity.blocked,
                code="DANGLING_CONNECTOR",
                message=(
                    f"El fragmento {segment.index} comienza con «{phrase}», pero el "
                    "contexto inmediato fue eliminado al unir cortes no consecutivos."
                ),
                segment_id=segment.index,
                recommendation=(
                    "Añade contexto previo, elimina el conector ampliando el inicio, "
                    "o descarta este fragmento."
                ),
            )
        )
    return issues


def check_incomplete_endings(segments: list[SegmentView]) -> list[CoherenceIssue]:
    issues: list[CoherenceIssue] = []
    for segment in segments:
        incomplete = _ends_with_token(segment.text, _INCOMPLETE_ENDINGS)
        if incomplete:
            issues.append(
                CoherenceIssue(
                    severity=CoherenceSeverity.blocked,
                    code="INCOMPLETE_ENDING",
                    message=(
                        f"El fragmento {segment.index} termina con «{incomplete}», "
                        "dejando la frase incompleta."
                    ),
                    segment_id=segment.index,
                    recommendation="Extiende el final hasta cerrar la cláusula.",
                )
            )
            continue
        stripped = segment.text.strip()
        if stripped.endswith("¿") or (
            stripped.endswith("?") and "¿" in stripped and segment.index == len(segments)
        ):
            # A question at the end of the reel (or ending mid-question mark).
            if segment.index == len(segments) or stripped.endswith("¿"):
                issues.append(
                    CoherenceIssue(
                        severity=CoherenceSeverity.warning,
                        code="UNANSWERED_QUESTION",
                        message=(
                            f"El fragmento {segment.index} deja una pregunta sin "
                            "respuesta en el Reel."
                        ),
                        segment_id=segment.index,
                        recommendation=(
                            "Incluye la respuesta o recorta antes de formular la pregunta."
                        ),
                    )
                )
        # Question in a non-final segment whose next fragment does not look like an answer.
        if "¿" in stripped and "?" in stripped and segment.index < len(segments):
            nxt = segments[segment.index]
            if _overlap_ratio(stripped, nxt.text) < 0.08 and nxt.gap_before > 1.0:
                issues.append(
                    CoherenceIssue(
                        severity=CoherenceSeverity.warning,
                        code="UNANSWERED_QUESTION",
                        message=(
                            f"El fragmento {segment.index} hace una pregunta cuya "
                            "respuesta parece haberse eliminado."
                        ),
                        segment_id=segment.index,
                        recommendation="Añade el fragmento que responde o elimina la pregunta.",
                    )
                )
    return issues


def check_pronouns_without_antecedent(segments: list[SegmentView]) -> list[CoherenceIssue]:
    issues: list[CoherenceIssue] = []
    for segment in segments[1:]:
        if segment.gap_before < 0.5:
            continue
        opener = _starts_with_phrase(segment.text, _PRONOUN_OPENERS)
        if opener is None:
            continue
        previous = segments[segment.index - 2]
        # Crude antecedent search: a capitalized proper-looking token or noun-ish
        # word in the previous ending.
        prev_tail = " ".join(_tokens(previous.text)[-12:])
        has_name = bool(re.search(r"\b[A-ZÁÉÍÓÚÑ][a-záéíóúñ]{2,}\b", previous.text))
        if has_name or len(prev_tail.split()) >= 6:
            # Still warn: the referent may have lived in the deleted gap.
            severity = CoherenceSeverity.warning
        else:
            severity = CoherenceSeverity.blocked
        issues.append(
            CoherenceIssue(
                severity=severity,
                code="MISSING_ANTECEDENT",
                message=(
                    f"El fragmento {segment.index} comienza con «{opener}» sin un "
                    "referente evidente tras el salto."
                ),
                segment_id=segment.index,
                recommendation=(
                    "Incluye la frase que presenta el referente o reformula el corte."
                ),
            )
        )
    return issues


def check_abrupt_topic_changes(segments: list[SegmentView]) -> list[CoherenceIssue]:
    issues: list[CoherenceIssue] = []
    for prev, nxt in zip(segments, segments[1:], strict=False):
        if nxt.gap_before < 1.0:
            continue
        prev_tail = " ".join(_tokens(prev.text)[-18:])
        next_head = " ".join(_tokens(nxt.text)[:18:])
        ratio = _overlap_ratio(prev_tail, next_head)
        if ratio < 0.06:
            issues.append(
                CoherenceIssue(
                    severity=CoherenceSeverity.warning,
                    code="ABRUPT_TOPIC_CHANGE",
                    message=(
                        f"Cambio de tema abrupto entre los fragmentos {prev.index} y "
                        f"{nxt.index} (poca continuidad léxica tras un salto de "
                        f"{nxt.gap_before:.1f}s)."
                    ),
                    segment_id=nxt.index,
                    recommendation=(
                        "Añade un puente de contexto o verifica que el significado "
                        "se conserve sin el material omitido."
                    ),
                )
            )
    return issues


def check_dangling_references(
    segments: list[SegmentView],
    *,
    deleted_context: list[str],
) -> list[CoherenceIssue]:
    """Flag references whose explanation likely lived in the deleted gaps."""
    issues: list[CoherenceIssue] = []
    for segment in segments:
        norm = normalize(segment.text)
        for phrase in _DANGLING_REFERENCES:
            if phrase not in norm:
                continue
            # Only complain when neighbouring deleted context actually mentioned
            # related material, or when this is not the first fragment after a gap.
            gap_text = ""
            if segment.index >= 2:
                gap_text = deleted_context[segment.index - 2] if deleted_context else ""
            explanation_missing = True
            if gap_text:
                explanation_missing = True
            elif segment.index == 1 and not gap_text:
                # First segment may introduce "este punto" legitimately.
                continue
            if explanation_missing and (
                segment.gap_before > 0.5 or (gap_text and phrase.split()[0] in normalize(gap_text))
            ):
                issues.append(
                    CoherenceIssue(
                        severity=CoherenceSeverity.warning,
                        code="DANGLING_REFERENCE",
                        message=(
                            f"El fragmento {segment.index} menciona «{phrase}», pero "
                            "la explicación necesaria parece haber sido eliminada."
                        ),
                        segment_id=segment.index,
                        recommendation=(
                            "Restaura el contexto aludido o elimina la referencia."
                        ),
                    )
                )
                break
    return issues


def check_artificial_pauses(segments: list[SegmentView]) -> list[CoherenceIssue]:
    """Hard cuts across large source gaps often feel like artificial pauses."""
    issues: list[CoherenceIssue] = []
    for segment in segments[1:]:
        if segment.gap_before >= 3.0:
            issues.append(
                CoherenceIssue(
                    severity=CoherenceSeverity.warning,
                    code="ARTIFICIAL_PAUSE",
                    message=(
                        f"El empalme hacia el fragmento {segment.index} salta "
                        f"{segment.gap_before:.1f}s del original; el corte puede "
                        "sonar como una pausa artificial."
                    ),
                    segment_id=segment.index,
                    recommendation=(
                        "Usa un fundido corto, añade audio de continuidad o acorta "
                        "el vacío incluyendo más contexto."
                    ),
                )
            )
    return issues


def run_text_rules(
    segments: list[SegmentView],
    *,
    words: list[TranscriptWordView],
    deleted_context: list[str],
) -> list[CoherenceIssue]:
    """Run every deterministic textual rule and return findings."""
    findings: list[CoherenceIssue] = []
    findings.extend(check_word_cuts(segments, words))
    findings.extend(check_dangling_starters(segments))
    findings.extend(check_incomplete_endings(segments))
    findings.extend(check_pronouns_without_antecedent(segments))
    findings.extend(check_abrupt_topic_changes(segments))
    findings.extend(check_dangling_references(segments, deleted_context=deleted_context))
    findings.extend(check_artificial_pauses(segments))
    return findings
