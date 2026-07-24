"""Editorial prompts for the Christian-reformed clip analyst."""

from __future__ import annotations

from app.services.ai.schemas import AnalysisRequest

SYSTEM_PROMPT = """\
Actúa como editor de contenido cristiano reformado. Selecciona momentos que \
sean fieles al sermón, comprensibles fuera de contexto y apropiados para Shorts. \
Cada Reel puede unir varios fragmentos no consecutivos para eliminar \
repeticiones, silencios o desvíos secundarios, pero nunca puede alterar el \
significado del predicador. No inventes palabras ni reformules declaraciones \
como si hubieran sido pronunciadas. Devuelve solo fragmentos reales con sus \
tiempos.

Criterios a priorizar:
- claridad bíblica;
- centralidad de Cristo;
- aplicación pastoral;
- arrepentimiento;
- fe;
- gracia;
- santidad;
- esperanza;
- frase memorable;
- inicio fuerte;
- conclusión clara.

Evita:
- anuncios;
- saludos;
- oraciones extensas;
- problemas técnicos;
- frases incompletas;
- afirmaciones que dependan demasiado del contexto;
- cortes que cambien el sentido;
- sensacionalismo;
- promesas de prosperidad;
- titulares que el predicador no sostuvo.

Reglas técnicas:
1. Cada segmento debe citar `exact_text` copiado literalmente de la \
transcripción (sin inventar ni parafrasear).
2. `start` y `end` son segundos absolutos del video original.
3. Un Reel puede tener varios segmentos no consecutivos; ordénalos \
cronológicamente.
4. La duración total del Reel (suma de segmentos) debe caer entre el mínimo y \
el máximo pedidos.
5. No inventes hashtags sensacionalistas ni títulos que el predicador no \
sostuvo.
6. Si un corte elimina contexto necesario, rellénalo en \
`removed_context_warning`; si no, deja null.
7. Devuelve únicamente JSON válido conforme al esquema.
"""


def build_user_prompt(request: AnalysisRequest) -> str:
    """Assemble the user message with metadata, preferences and timed text."""
    meta = request.metadata
    prefs = request.preferences
    lines: list[str] = [
        "## Metadatos del sermón",
        f"- Título: {meta.title}",
        f"- Predicador: {meta.preacher_name or '(no indicado)'}",
        f"- Referencia bíblica: {meta.bible_reference or '(no indicada)'}",
        f"- Iglesia: {meta.church_name}",
        f"- Canal: {meta.youtube_channel}",
        f"- Duración total: {meta.duration_seconds:.1f} s",
        "",
        "## Preferencias",
        f"- Máximo de Reels a sugerir: {prefs.max_reels}",
        f"- Duración deseada por Reel: {prefs.min_duration_seconds:.0f}"
        f"–{prefs.max_duration_seconds:.0f} s",
        f"- Orientación doctrinal/editorial: {prefs.doctrinal_orientation}",
    ]
    if prefs.additional_instructions:
        lines.append(f"- Instrucciones adicionales del usuario: {prefs.additional_instructions}")

    if request.chunk_count > 1:
        lines += [
            "",
            f"## Bloque {request.chunk_index + 1} de {request.chunk_count}",
            f"- Ventana temporal de este bloque: "
            f"{request.chunk_start:.1f}–{request.chunk_end:.1f} s",
            "- Conserva los tiempos absolutos del video (no los renumeres).",
            "- Sugiere solo clips contenidos en esta ventana; otra etapa "
            "combinará candidatos globales.",
        ]

    lines += ["", "## Transcripción sincronizada (tiempos absolutos)"]
    for segment in request.segments:
        lines.append(f"[{segment.start:.2f}–{segment.end:.2f}] {segment.text.strip()}")

    lines += [
        "",
        "Devuelve un objeto JSON con la clave `clips`. Cada clip puede contener "
        "varios `segments` no consecutivos. `exact_text` debe coincidir con el "
        "texto real de la transcripción en ese intervalo.",
    ]
    return "\n".join(lines)


def build_merge_prompt(
    *,
    request: AnalysisRequest,
    candidate_json: str,
) -> str:
    """Final-stage prompt that ranks and deduplicates chunk candidates."""
    prefs = request.preferences
    meta = request.metadata
    return "\n".join(
        [
            "## Tarea de combinación global",
            "Recibes candidatos generados por bloques de la misma predicación.",
            "Combínalos en una lista final de Reels únicos, sin duplicar ideas,",
            "respetando la duración y el máximo pedidos. Conserva solo fragmentos",
            "reales (no inventes texto ni tiempos).",
            "",
            f"- Sermón: {meta.title} ({meta.duration_seconds:.1f} s)",
            f"- Máximo de Reels: {prefs.max_reels}",
            f"- Duración: {prefs.min_duration_seconds:.0f}–{prefs.max_duration_seconds:.0f} s",
            f"- Orientación: {prefs.doctrinal_orientation}",
            "",
            "## Candidatos por bloque (JSON)",
            candidate_json,
            "",
            "Devuelve el objeto JSON final con la clave `clips`.",
        ]
    )
