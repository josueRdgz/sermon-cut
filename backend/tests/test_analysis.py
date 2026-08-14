"""Unit tests for AI analysis validation, mock provider and chunking."""

from __future__ import annotations

import pytest
from app.services.ai.house_style import context_block
from app.services.ai.mock_provider import MockAIProvider
from app.services.ai.prompts import build_user_prompt
from app.services.ai.schemas import (
    AnalysisPreferences,
    AnalysisRequest,
    AnalysisResponse,
    SermonMetadata,
    SuggestedClip,
    SuggestedSegment,
    TranscriptSegmentInput,
    TranscriptWordInput,
)
from app.services.analysis.chunking import chunk_segments
from app.services.analysis.validate import (
    normalize_text,
    snap_to_words,
    validate_analysis_response,
)


def _segments() -> list[TranscriptSegmentInput]:
    texts = [
        (0.0, 8.0, "La gracia de Dios es suficiente para todo pecador arrepentido."),
        (8.0, 16.0, "Cristo es el centro de la predicación y de nuestra esperanza."),
        (20.0, 28.0, "Por tanto, arrepiéntanse y crean en el evangelio de gracia."),
        (40.0, 50.0, "La santidad no es opcional para quien ha sido redimido por Cristo."),
        (55.0, 65.0, "Guardemos esta esperanza hasta el día en que Él vuelva."),
    ]
    return [
        TranscriptSegmentInput(
            order=index,
            start=start,
            end=end,
            text=text,
            words=[
                TranscriptWordInput(
                    start=start + i * 0.4,
                    end=start + (i + 1) * 0.4,
                    text=word,
                )
                for i, word in enumerate(text.split())
            ],
        )
        for index, (start, end, text) in enumerate(texts)
    ]


def _request(**overrides: object) -> AnalysisRequest:
    prefs = AnalysisPreferences(
        max_reels=3,
        min_duration_seconds=8.0,
        max_duration_seconds=40.0,
    )
    base = AnalysisRequest(
        metadata=SermonMetadata(
            title="La gracia suficiente",
            church_name="Iglesia Central",
            youtube_channel="@central",
            duration_seconds=70.0,
        ),
        segments=_segments(),
        preferences=prefs,
    )
    return base.model_copy(update=overrides) if overrides else base


def test_normalize_text_strips_punctuation_and_case() -> None:
    assert normalize_text("¡La Gracia, de Dios!") == "la gracia de dios"


def test_mock_provider_is_deterministic_and_uses_real_text() -> None:
    provider = MockAIProvider()
    request = _request()
    first = provider.analyze(request)
    second = provider.analyze(request)
    assert first.response.model_dump() == second.response.model_dump()
    assert first.response.clips
    transcript_blob = " ".join(seg.text for seg in request.segments)
    for clip in first.response.clips:
        for segment in clip.segments:
            assert segment.exact_text in transcript_blob


def test_validate_accepts_literal_evidence_and_snaps_times() -> None:
    segments = _segments()
    response = AnalysisResponse(
        clips=[
            SuggestedClip(
                title="Gracia suficiente",
                hook="La gracia de Dios",
                summary="...",
                editorial_score=8.0,
                segments=[
                    SuggestedSegment(
                        start=0.2,
                        end=7.5,
                        exact_text="La gracia de Dios es suficiente para todo pecador arrepentido.",
                        reason="inicio fuerte",
                    )
                ],
                joined_script="La gracia de Dios es suficiente para todo pecador arrepentido.",
                caption="...",
                hashtags=["#gracia"],
            )
        ]
    )
    report = validate_analysis_response(response, segments=segments, video_duration=70.0)
    assert len(report.accepted) == 1
    assert report.rejected == []
    validated = report.accepted[0].segments[0]
    assert validated.snapped is True
    assert validated.start == pytest.approx(0.0)
    assert validated.end == pytest.approx(4.08)
    assert validated.match_ratio == pytest.approx(1.0)


def test_validate_rejects_invented_words() -> None:
    response = AnalysisResponse(
        clips=[
            SuggestedClip(
                title="Inventado",
                segments=[
                    SuggestedSegment(
                        start=0.0,
                        end=8.0,
                        exact_text="Dios te promete prosperidad financiera inmediata.",
                        reason="sensacionalismo",
                    )
                ],
            )
        ]
    )
    report = validate_analysis_response(response, segments=_segments(), video_duration=70.0)
    assert report.accepted == []
    assert report.rejected
    assert "exact_text" in report.rejected[0]


def test_validate_rejects_inverted_and_out_of_bounds() -> None:
    response = AnalysisResponse(
        clips=[
            SuggestedClip(
                title="Invertido",
                segments=[SuggestedSegment(start=8.0, end=2.0, exact_text="Cristo es el centro")],
            ),
            SuggestedClip(
                title="Fuera",
                segments=[
                    SuggestedSegment(
                        start=100.0,
                        end=110.0,
                        exact_text="La gracia de Dios es suficiente para todo pecador arrepentido.",
                    )
                ],
            ),
        ]
    )
    report = validate_analysis_response(response, segments=_segments(), video_duration=70.0)
    assert report.accepted == []
    assert len(report.rejected) == 2


def test_validate_rejects_overlapping_segments_in_one_clip() -> None:
    response = AnalysisResponse(
        clips=[
            SuggestedClip(
                title="Solape",
                segments=[
                    SuggestedSegment(
                        start=0.0,
                        end=10.0,
                        exact_text="La gracia de Dios es suficiente para todo pecador arrepentido.",
                    ),
                    SuggestedSegment(
                        start=8.0,
                        end=16.0,
                        exact_text="Cristo es el centro de la predicación y de nuestra esperanza.",
                    ),
                ],
            )
        ]
    )
    report = validate_analysis_response(response, segments=_segments(), video_duration=70.0)
    assert report.accepted == []
    assert "overlapping" in report.rejected[0]


def test_validate_rejects_more_than_three_source_segments() -> None:
    segments = _segments()
    response = AnalysisResponse(
        clips=[
            SuggestedClip(
                title="Demasiados cortes",
                segments=[
                    SuggestedSegment(
                        start=item.start,
                        end=item.end,
                        exact_text=item.text,
                    )
                    for item in (segments[0], segments[2], segments[3], segments[4])
                ],
            )
        ]
    )

    report = validate_analysis_response(
        response,
        segments=segments,
        video_duration=70.0,
        max_segments_per_clip=3,
    )

    assert report.accepted == []
    assert "too many segments" in report.rejected[0]


def test_context_block_does_not_repeat_house_style() -> None:
    lines = context_block(church_name="IBSJ", editorial_context="Prioriza la aplicación.")
    blob = "\n".join(lines)
    assert "IBSJ" in blob
    assert "Prioriza la aplicación." in blob
    assert "Iglesias que publican" not in blob


def test_prompt_requests_long_passages_and_at_most_three_segments() -> None:
    prompt = build_user_prompt(_request())

    assert "Máximo de fragmentos/cortes por Reel: 3" in prompt
    assert "Duración mínima por fragmento: 8 s" in prompt
    assert "no cortes por cada frase" in prompt
    assert "frase memorable" in prompt
    assert "gancho audible" in prompt


def test_chunk_segments_preserves_absolute_times() -> None:
    # Build segments long enough to force a split above the 1k-char floor.
    filler = "palabra " * 80
    segments = [
        TranscriptSegmentInput(
            order=i,
            start=float(i * 10),
            end=float(i * 10 + 8),
            text=f"Bloque {i}: {filler}",
        )
        for i in range(4)
    ]
    chunks = chunk_segments(segments, char_limit=1_200)
    assert len(chunks) >= 2
    assert chunks[0].start == segments[0].start
    assert all(chunk.segments for chunk in chunks)
    flat = [seg.start for chunk in chunks for seg in chunk.segments]
    assert flat == sorted(flat)


def test_snap_to_words_expands_to_word_edges() -> None:
    words = [
        TranscriptWordInput(start=1.0, end=1.4, text="gracia"),
        TranscriptWordInput(start=1.4, end=1.8, text="de"),
        TranscriptWordInput(start=1.8, end=2.3, text="Dios"),
    ]
    start, end, snapped = snap_to_words(1.1, 2.0, words)
    assert snapped is True
    assert start == 1.0
    assert end == 2.3
