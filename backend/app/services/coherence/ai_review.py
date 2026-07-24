"""Optional Gemini review of a joined Reel script.

Sends only the joined script plus a little surrounding context. Gemini must not
rewrite the sermon — it only judges whether the cut preserves meaning.
"""

from __future__ import annotations

import json
import logging
from typing import Any

from pydantic import BaseModel, Field

from app.core.config import get_settings
from app.schemas.coherence import CoherenceIssue, CoherenceSeverity

logger = logging.getLogger(__name__)

_SYSTEM = """\
Eres un revisor editorial de cortes para Shorts cristianos. Se te da el guion \
UNIDO de un Reel (fragmentos no consecutivos ya concatenados) y un poco de \
contexto anterior/posterior eliminado. Responde SOLO si el corte conserva el \
significado del predicador o si resulta engañoso/incoherente.

Reglas:
- No reescribas el sermón.
- No inventes texto.
- No sugieras un guion nuevo.
- Devuelve JSON con findings.
"""


class AiCoherenceFinding(BaseModel):
    severity: CoherenceSeverity = CoherenceSeverity.warning
    code: str = "AI_MEANING_RISK"
    message: str
    segment_id: int = Field(default=1, ge=1)
    recommendation: str = ""


class AiCoherenceResponse(BaseModel):
    preserves_meaning: bool = True
    findings: list[AiCoherenceFinding] = Field(default_factory=list)


def review_joined_script(
    *,
    joined_script: str,
    before_context: str,
    after_context: str,
    segment_count: int,
) -> list[CoherenceIssue]:
    """Call Gemini when configured; otherwise return an empty list."""
    settings = get_settings()
    api_key = (settings.gemini_api_key or "").strip()
    if not api_key:
        return []

    try:
        from google import genai
    except ImportError:
        logger.info("google-genai not installed; skipping coherence AI review")
        return []

    user = "\n".join(
        [
            "## Guion unido del Reel (no lo reescribas)",
            joined_script.strip() or "(vacío)",
            "",
            "## Contexto eliminado justo antes del primer corte",
            before_context.strip() or "(ninguno)",
            "",
            "## Contexto eliminado entre cortes / después",
            after_context.strip() or "(ninguno)",
            "",
            f"El Reel tiene {segment_count} fragmento(s).",
            "¿El corte conserva el significado? Si hay riesgo, enumera findings.",
        ]
    )

    try:
        client = genai.Client(
            api_key=api_key,
            http_options={"timeout": int(settings.gemini_timeout_seconds * 1000)},
        )
        response = client.models.generate_content(
            model=settings.gemini_model,
            contents=user,
            config={
                "system_instruction": _SYSTEM,
                "response_mime_type": "application/json",
                "response_json_schema": AiCoherenceResponse.model_json_schema(),
                "temperature": 0.1,
            },
        )
        parsed = _parse(response)
    except Exception as exc:  # noqa: BLE001 — AI review must never break validation
        logger.warning("Coherence AI review failed: %s", exc)
        return [
            CoherenceIssue(
                severity=CoherenceSeverity.warning,
                code="AI_REVIEW_UNAVAILABLE",
                message=f"No se pudo completar la revisión opcional con IA: {exc}",
                segment_id=1,
                recommendation="Puedes ignorar este aviso o reintentar más tarde.",
            )
        ]

    issues: list[CoherenceIssue] = []
    if not parsed.preserves_meaning and not parsed.findings:
        issues.append(
            CoherenceIssue(
                severity=CoherenceSeverity.warning,
                code="AI_MEANING_RISK",
                message="La revisión opcional indica que el corte podría alterar el significado.",
                segment_id=1,
                recommendation="Revisa el guion unido o añade el contexto eliminado.",
            )
        )
    for finding in parsed.findings:
        severity = finding.severity
        if severity == CoherenceSeverity.valid:
            severity = CoherenceSeverity.warning
        issues.append(
            CoherenceIssue(
                severity=severity,
                code=finding.code or "AI_MEANING_RISK",
                message=finding.message,
                segment_id=min(max(1, finding.segment_id), max(1, segment_count)),
                recommendation=finding.recommendation
                or "Revisa el empalme o añade contexto.",
            )
        )
    return issues


def _parse(response: Any) -> AiCoherenceResponse:
    text = getattr(response, "text", None) or ""
    if not text:
        return AiCoherenceResponse()
    try:
        return AiCoherenceResponse.model_validate_json(text)
    except Exception:
        data = json.loads(text)
        return AiCoherenceResponse.model_validate(data)
