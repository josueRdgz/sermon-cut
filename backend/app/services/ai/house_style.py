"""Shared editorial house style for Reels and Video Highlights."""

from __future__ import annotations

CHURCH_SOCIAL_STYLE = """\
Estilo de clip de iglesias que publican bien en Reels y Shorts \
(p. ej. IBSJ y canales similares): debe sentirse como un video publicado \
por una iglesia, no como un resumen académico del sermón.

Selección:
- Los primeros 2 segundos enganchan con tesis, contraste o pregunta. \
Nunca empieces con saludo, anuncio, oración larga o “vamos a ver”.
- Un Reel = UNA idea. Un Highlights = las mejores frases y aplicaciones, \
no todos los puntos del predicador.
- Conserva la frase más memorable, casi lista para subtítulo.
- Cierra con aplicación concreta: qué creer, decidir o hacer esta semana.
- Corta rodeos, repeticiones, muletillas y transiciones de predicador.

Títulos y empaque:
- Título recommended: 4 a 10 palabras, citable, bíblico, tono de iglesia local.
- Preferible una cita o contraste del predicador, no un tema genérico \
(“Predicación sobre la gracia”).
- thumbnail_text: 2 a 5 palabras en mayúsculas con la tesis.
- hook: la primera frase que se oye, copiada del intervalo, no un resumen.
- Sin clickbait secular ni promesas de prosperidad.
- Fidelidad total a las palabras del predicador.
"""

TITLE_PACKAGING = """\
Al rankear o titular, premia: (1) gancho audible de inmediato, \
(2) frase memorable, (3) aplicación clara. Descarta clips que empiezan \
con saludo o “el siguiente punto” y títulos que solo nombran el tema.
"""


def with_house_style(base: str) -> str:
    return f"{base.rstrip()}\n\n{CHURCH_SOCIAL_STYLE.strip()}\n"


def context_block(*, church_name: str | None, editorial_context: str | None) -> list[str]:
    lines: list[str] = []
    if church_name:
        lines.append(
            f"Iglesia del proyecto: {church_name}. Adapta el tono a esa congregación "
            "sin copiar el nombre de otra iglesia en títulos o hashtags."
        )
    extra = (editorial_context or "").strip()
    if extra:
        lines.append(f"Indicaciones adicionales del editor: {extra}")
    return lines
