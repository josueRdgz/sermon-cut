"""Salience ranking keeps memorable phrases and applications when compacting."""

from __future__ import annotations

from app.services.ai.schemas import TranscriptSegmentInput
from app.services.highlights.salience import compact_transcript_lines, score_line


def test_score_prefers_application_and_quotable_over_announcements() -> None:
    application = score_line(
        "Por eso, hermano, esta semana cree el evangelio y obedece a Cristo en tu casa."
    )
    quote = score_line("La gracia no es un premio; la gracia es Cristo mismo dándose a ti.")
    filler = score_line("Bienvenidos, estos son los anuncios y la ofrenda de la semana.")
    assert application > quote > filler


def test_compact_keeps_application_when_budget_is_tight() -> None:
    segments = [
        TranscriptSegmentInput(order=0, start=0, end=8, text="Bienvenidos al servicio de hoy."),
        TranscriptSegmentInput(
            order=1, start=20, end=40, text="Vamos a ver el siguiente punto del mensaje."
        ),
        TranscriptSegmentInput(
            order=2,
            start=400,
            end=430,
            text="Por eso, usted hoy tiene que decidir si cree esta gracia y la vive.",
        ),
        TranscriptSegmentInput(
            order=3, start=800, end=820, text="Como les decía, pasemos ahora a otro detalle."
        ),
        TranscriptSegmentInput(
            order=4, start=1180, end=1200, text="Oremos y que Dios les bendiga a todos."
        ),
    ]
    for index in range(40):
        segments.insert(
            3,
            TranscriptSegmentInput(
                order=10 + index,
                start=500 + index * 6,
                end=505 + index * 6,
                text=f"Repetición de apoyo número {index} sin tesis clara.",
            ),
        )
    lines = compact_transcript_lines(segments, char_budget=900)
    blob = "\n".join(lines)
    assert "usted hoy tiene que decidir" in blob
    assert "★" in blob
    assert sum(len(line) + 1 for line in lines) <= 920
