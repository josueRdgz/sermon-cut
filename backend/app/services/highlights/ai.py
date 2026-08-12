"""Strict Gemini analysis for coherent horizontal sermon highlights."""

from __future__ import annotations

import json
import logging
import time
from dataclasses import dataclass
from typing import Any

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from app.core.config import Settings, get_settings
from app.core.exceptions import AppError, ValidationAppError
from app.services.ai.gemini_schema import serving_json_schema
from app.services.ai.house_style import TITLE_PACKAGING, context_block, with_house_style
from app.services.ai.schemas import TranscriptSegmentInput
from app.services.analysis.validate import normalize_text
from app.services.highlights.salience import compact_transcript_lines as _compact_transcript_lines

logger = logging.getLogger(__name__)
_RETRYABLE = {408, 429, 500, 502, 503, 504}


class _Strict(BaseModel):
    # Ignore unknown keys from Gemini after the serving schema was simplified.
    model_config = ConfigDict(extra="ignore")


class AITitles(_Strict):
    recommended: str = Field(min_length=1, max_length=300)
    direct: str = Field(min_length=1, max_length=300)
    emotional: str = Field(min_length=1, max_length=300)
    biblical: str = Field(min_length=1, max_length=300)
    search_focused: str = Field(min_length=1, max_length=300)


_HIGHLIGHT_CATEGORIES = (
    "hook",
    "theme",
    "biblical",
    "application",
    "illustration",
    "conclusion",
)
_CATEGORY_ALIASES = {
    "hook": "hook",
    "gancho": "hook",
    "opening": "hook",
    "intro": "hook",
    "introduction": "hook",
    "theme": "theme",
    "tema": "theme",
    "topic": "theme",
    "biblical": "biblical",
    "doctrinal": "biblical",
    "development": "biblical",
    "desarrollobiblico": "biblical",
    "desarrollodoctrinal": "biblical",
    "biblicaldoctrinal": "biblical",
    "biblicaldoctrinaldevelopment": "biblical",
    "application": "application",
    "aplicacion": "application",
    "apply": "application",
    "illustration": "illustration",
    "ilustracion": "illustration",
    "example": "illustration",
    "story": "illustration",
    "historia": "illustration",
    "conclusion": "conclusion",
    "cierre": "conclusion",
    "closing": "conclusion",
    "close": "conclusion",
    "outro": "conclusion",
}


def _fold_ascii(value: str) -> str:
    table = str.maketrans("áéíóúüñÁÉÍÓÚÜÑ", "aeiouunAEIOUUN")
    return value.translate(table)


def _normalize_category(value: str) -> str:
    raw = _fold_ascii(value).strip().lower()
    compact = "".join(character for character in raw if character.isalnum())
    if raw in _HIGHLIGHT_CATEGORIES:
        return raw
    if compact in _CATEGORY_ALIASES:
        return _CATEGORY_ALIASES[compact]
    for canonical in _HIGHLIGHT_CATEGORIES:
        if canonical in compact:
            return canonical
    raise ValueError(
        f"category must be one of {', '.join(_HIGHLIGHT_CATEGORIES)} (got {value!r})"
    )


def _normalize_score(value: float) -> float:
    if 0.0 <= value <= 1.0:
        return float(value)
    if 1.0 < value <= 10.0:
        return round(value / 10.0, 4)
    if 10.0 < value <= 100.0:
        return round(value / 100.0, 4)
    raise ValueError("score must be between 0 and 1 (or 0–10 / 0–100)")


class AIHighlightSegment(_Strict):
    start: float = Field(ge=0)
    end: float = Field(gt=0)
    transcript: str = Field(min_length=1, max_length=6000)
    reason: str = Field(min_length=1, max_length=1000)
    score: float = Field(ge=0, le=1)
    category: str = Field(pattern="^(hook|theme|biblical|application|illustration|conclusion)$")

    @field_validator("score", mode="before")
    @classmethod
    def coerce_score(cls, value: object) -> float:
        return _normalize_score(float(value))  # type: ignore[arg-type]

    @field_validator("category", mode="before")
    @classmethod
    def coerce_category(cls, value: object) -> str:
        return _normalize_category(str(value))

    @model_validator(mode="after")
    def validate_range(self) -> AIHighlightSegment:
        if self.end <= self.start:
            raise ValueError("end must be greater than start")
        return self


class HighlightAIResponse(_Strict):
    title_theme: str = Field(min_length=1, max_length=300)
    biblical_references: list[str] = Field(default_factory=list, max_length=30)
    highlights: list[AIHighlightSegment] = Field(min_length=2, max_length=40)
    suggested_titles: AITitles
    thumbnail_text: str = Field(min_length=1, max_length=120)
    description: str = Field(min_length=1, max_length=3000)
    hashtags: list[str] = Field(min_length=3, max_length=8)
    keywords: list[str] = Field(min_length=3, max_length=20)


@dataclass(frozen=True)
class HighlightUsage:
    prompt_tokens: int | None = None
    completion_tokens: int | None = None
    total_tokens: int | None = None


@dataclass(frozen=True)
class HighlightResult:
    response: HighlightAIResponse
    usage: HighlightUsage


class HighlightProvider:
    """Gemini-only provider: production analysis never fabricates offline output."""

    name = "gemini"

    def __init__(self, settings: Settings | None = None) -> None:
        self.settings = settings or get_settings()
        self.api_key = (self.settings.gemini_api_key or "").strip()
        if not self.api_key:
            raise ValidationAppError(
                "Configure SERMON_CUT_GEMINI_API_KEY para analizar Video Highlights.",
                code="highlight_ai_not_configured",
            )
        self._client: Any | None = None

    def analyze(
        self,
        *,
        project_title: str,
        preacher_name: str | None,
        bible_reference: str | None,
        segments: list[TranscriptSegmentInput],
        sermon_start: float,
        sermon_end: float,
        target_duration_seconds: int,
        editorial_style: str,
        church_name: str | None = None,
        editorial_context: str | None = None,
    ) -> HighlightResult:
        eligible = [
            item
            for item in segments
            if item.end > sermon_start and item.start < sermon_end
        ]
        if not eligible:
            raise ValidationAppError(
                "No hay transcripción dentro del intervalo de predicación.",
                code="highlight_empty_sermon_range",
            )
        prompt = _build_prompt(
            project_title=project_title,
            preacher_name=preacher_name,
            bible_reference=bible_reference,
            church_name=church_name,
            editorial_context=editorial_context,
            segments=eligible,
            sermon_start=sermon_start,
            sermon_end=sermon_end,
            target_duration_seconds=target_duration_seconds,
            editorial_style=editorial_style,
        )
        response, usage = self._generate(prompt)
        validated = validate_highlight_response(
            response,
            transcript=eligible,
            sermon_start=sermon_start,
            sermon_end=sermon_end,
            target_duration_seconds=target_duration_seconds,
        )
        return HighlightResult(response=validated, usage=usage)

    def _get_client(self) -> Any:
        if self._client is not None:
            return self._client
        try:
            from google import genai
        except ImportError as exc:
            raise AppError(
                'Instale el componente de IA con: pip install -e ".[gemini]"',
                code="gemini_sdk_missing",
                status_code=503,
            ) from exc
        self._client = genai.Client(
            api_key=self.api_key,
            http_options={"timeout": int(self.settings.gemini_timeout_seconds * 1000)},
        )
        return self._client

    def _generate(self, prompt: str) -> tuple[HighlightAIResponse, HighlightUsage]:
        last_error: Exception | None = None
        attempts = max(1, min(self.settings.gemini_max_attempts, 3))
        for attempt in range(attempts):
            try:
                raw = self._get_client().models.generate_content(
                    model=self.settings.gemini_model,
                    contents=prompt,
                    config={
                        "system_instruction": _SYSTEM_PROMPT,
                        "response_mime_type": "application/json",
                        "response_json_schema": serving_json_schema(HighlightAIResponse),
                        "temperature": 0.28,
                    },
                )
                text = getattr(raw, "text", None)
                if not text:
                    raise ValueError("Gemini devolvió una respuesta vacía.")
                try:
                    parsed = HighlightAIResponse.model_validate_json(text)
                except Exception:
                    parsed = HighlightAIResponse.model_validate(json.loads(text))
                metadata = getattr(raw, "usage_metadata", None)
                return parsed, HighlightUsage(
                    prompt_tokens=_optional_int(getattr(metadata, "prompt_token_count", None)),
                    completion_tokens=_optional_int(
                        getattr(metadata, "candidates_token_count", None)
                    ),
                    total_tokens=_optional_int(getattr(metadata, "total_token_count", None)),
                )
            except Exception as exc:  # noqa: BLE001
                last_error = exc
                if attempt + 1 >= attempts or not _retryable(exc):
                    break
                time.sleep((1.0, 2.0, 4.0)[attempt])
        raise AppError(
            f"No se pudo completar el análisis de Highlights: {last_error}",
            code="highlight_ai_failed",
            status_code=502,
        ) from last_error


def validate_highlight_response(
    response: HighlightAIResponse,
    *,
    transcript: list[TranscriptSegmentInput],
    sermon_start: float,
    sermon_end: float,
    target_duration_seconds: int,
) -> HighlightAIResponse:
    """Reject unsupported text, overlaps, invalid order and extreme duration drift."""
    ordered = sorted(response.highlights, key=lambda item: item.start)
    previous_end = sermon_start
    raw_previous_end = sermon_start
    total = 0.0
    categories: set[str] = set()
    adjusted: list[AIHighlightSegment] = []
    for item in ordered:
        if item.start < sermon_start - 0.5 or item.end > sermon_end + 0.5:
            raise ValidationAppError(
                "La IA propuso un fragmento fuera del intervalo de predicación.",
                code="highlight_segment_out_of_range",
            )
        if item.start < raw_previous_end - 0.05:
            raise ValidationAppError(
                "La IA propuso fragmentos superpuestos o fuera de orden.",
                code="highlight_segments_overlap",
            )
        haystack = " ".join(
            segment.text
            for segment in transcript
            if segment.end >= item.start - 1.0 and segment.start <= item.end + 1.0
        )
        expected = normalize_text(item.transcript)
        actual = normalize_text(haystack)
        tokens = expected.split()
        ratio = (
            1.0
            if expected and expected in actual
            else sum(token in set(actual.split()) for token in tokens) / max(len(tokens), 1)
        )
        if ratio < 0.76:
            raise ValidationAppError(
                "La IA devolvió texto sin evidencia suficiente en la transcripción.",
                code="highlight_transcript_mismatch",
            )
        snapped_start, snapped_end = _snap_to_spoken_edges(
            item.start,
            item.end,
            transcript,
            lower_bound=sermon_start,
            upper_bound=sermon_end,
        )
        if snapped_start < previous_end - 0.05:
            snapped_start = max(item.start, previous_end)
        if snapped_end <= snapped_start:
            raise ValidationAppError(
                "El ajuste a límites de palabra produjo un fragmento inválido.",
                code="highlight_segment_invalid_after_snap",
            )
        adjusted.append(
            item.model_copy(update={"start": round(snapped_start, 3), "end": round(snapped_end, 3)})
        )
        raw_previous_end = item.end
        previous_end = snapped_end
        total += snapped_end - snapped_start
        categories.add(item.category)

    minimum = target_duration_seconds * 0.55
    maximum = target_duration_seconds * 1.45
    if total < minimum or total > maximum:
        raise ValidationAppError(
            (
                f"La selección dura {total:.0f}s y se desvía demasiado del objetivo "
                f"de {target_duration_seconds}s."
            ),
            code="highlight_duration_out_of_range",
        )
    if "hook" not in categories or "conclusion" not in categories:
        raise ValidationAppError(
            "La selección debe incluir un gancho y una conclusión.",
            code="highlight_structure_incomplete",
        )
    if "application" not in categories:
        raise ValidationAppError(
            "La selección debe incluir al menos una aplicación concreta.",
            code="highlight_application_missing",
        )
    return response.model_copy(update={"highlights": adjusted})


def _snap_to_spoken_edges(
    start: float,
    end: float,
    transcript: list[TranscriptSegmentInput],
    *,
    lower_bound: float,
    upper_bound: float,
) -> tuple[float, float]:
    """Align to available word timestamps with a short natural breathing margin."""
    words = [
        word
        for segment in transcript
        if segment.end >= start - 1.0 and segment.start <= end + 1.0
        for word in segment.words
        if word.end >= start - 0.4 and word.start <= end + 0.4
    ]
    if not words:
        return start, end
    snapped_start = max(lower_bound, words[0].start - 0.18)
    snapped_end = min(upper_bound, words[-1].end + 0.22)
    return snapped_start, snapped_end


def _build_prompt(
    *,
    project_title: str,
    preacher_name: str | None,
    bible_reference: str | None,
    segments: list[TranscriptSegmentInput],
    sermon_start: float,
    sermon_end: float,
    target_duration_seconds: int,
    editorial_style: str,
    church_name: str | None = None,
    editorial_context: str | None = None,
) -> str:
    style_guide = _STYLE_GUIDANCE.get(editorial_style, _STYLE_GUIDANCE["balanced"])
    lines = [
        "Crea una edición horizontal de Video Highlights que alguien querría volver a ver.",
        f"Título del proyecto: {project_title}",
        f"Predicador: {preacher_name or 'No indicado'}",
        f"Referencia registrada: {bible_reference or 'No indicada'}",
        f"Iglesia: {church_name or 'No indicada'}",
        f"Intervalo confirmado: {sermon_start:.2f}-{sermon_end:.2f}s",
        f"Duración objetivo aproximada: {target_duration_seconds}s",
        f"Orientación editorial: {editorial_style}",
        style_guide,
        "",
        "Prioridad de selección, en este orden:",
        "1. Frases memorables: una idea que se podría citar, un contraste o una pregunta fuerte.",
        "2. Aplicaciones concretas: qué cree, decide o hace el oyente esta semana.",
        "3. El texto o argumento bíblico que sostiene esa frase, no toda la exposición.",
        "4. Un gancho al inicio y un cierre que recoja la tesis, no un saludo ni un amén vacío.",
        "Si hay que recortar para caber en la duración, recorta relleno expositivo, "
        "repeticiones y transiciones. Nunca recortes la mejor frase ni la mejor aplicación.",
        "Cada fragmento debe poder entenderse fuera de contexto, con respiración natural, "
        "sin cortar a mitad de oración. Incluye al menos un highlight con category=application.",
        "No selecciones saludos, anuncios, ofrendas, repeticiones, pausas, errores ni oraciones "
        "extensas sin contenido. No alteres el sentido doctrinal.",
        "Las líneas marcadas con ★ son candidatas fuertes: prefierelas si caben.",
        "Cada transcript debe copiar literalmente texto disponible dentro del intervalo. "
        "Los títulos, descripción, miniatura, hashtags y palabras clave deben estar "
        "respaldados por el contenido. Entrega cinco títulos con las categorías del esquema. "
        "recommended: 4 a 10 palabras, citable, como Reel de iglesia. "
        "thumbnail_text: 2 a 5 palabras en mayúsculas con la tesis, no el tema genérico.",
        TITLE_PACKAGING.strip(),
        "score es un número entre 0 y 1 (no 0–10). category debe ser exactamente uno de: "
        "hook, theme, biblical, application, illustration, conclusion (minúsculas).",
        "",
        *context_block(church_name=church_name, editorial_context=editorial_context),
        "",
        "TRANSCRIPCIÓN SINCRONIZADA:",
    ]
    lines.extend(_compact_transcript_lines(segments, char_budget=_PROMPT_CHAR_BUDGET))
    return "\n".join(lines)


_PROMPT_CHAR_BUDGET = 40_000

_STYLE_GUIDANCE = {
    "balanced": (
        "Equilibrio: gancho memorable, tesis, el mejor pulso bíblico, al menos una "
        "aplicación concreta y un cierre que la gente recuerde."
    ),
    "doctrinal": (
        "Prioriza fidelidad al texto y al argumento, pero no entregues solo exposición: "
        "incluye la aplicación pastoral de esa doctrina."
    ),
    "emotional": (
        "Prioriza frases que tocan conciencia, esperanza o consuelo, y conviértelas en "
        "aplicación concreta. Evita emoción sin tesis."
    ),
    "evangelistic": (
        "Prioriza el problema humano, la frase más clara del evangelio y una invitación "
        "o aplicación para responder a Cristo."
    ),
    "educational": (
        "Prioriza la idea enseñable y una aplicación práctica para la semana, no un "
        "resumen completo de todos los puntos."
    ),
    "brief": (
        "3 a 5 bloques. Quédate solo con la mejor frase, la mejor aplicación y un cierre. "
        "Corta desarrollo de relleno."
    ),
}


_SYSTEM_PROMPT = with_house_style("""\
Actúa como editor senior de contenido cristiano para YouTube. Tu trabajo no es \
resumir el sermón entero: es extraer las mejores frases, la tesis y las \
aplicaciones que un oyente citaría o pondría en práctica. Sé fiel al mensaje \
original y a la doctrina; no inventes palabras, referencias bíblicas, temas o \
promesas. Devuelve únicamente JSON válido conforme al esquema estricto. Los \
tiempos siempre pertenecen al video fuente y los fragmentos deben conservar \
orden cronológico salvo una razón editorial indispensable que no cambie el sentido.
""")


def _retryable(exc: Exception) -> bool:
    status = getattr(exc, "status_code", None) or getattr(exc, "code", None)
    if isinstance(status, int) and status in _RETRYABLE:
        return True
    value = f"{type(exc).__name__} {exc}".lower()
    if any(marker in value for marker in ("invalid_argument", "too many states")):
        return False
    if any(marker in value for marker in ("timeout", "timed out", "deadline", "cancelled")):
        return False
    return any(marker in value for marker in ("429", "500", "503", "unavailable"))


def _optional_int(value: object) -> int | None:
    try:
        return int(value) if value is not None else None
    except (TypeError, ValueError):
        return None
