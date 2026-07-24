"""Unit tests for join-coherence deterministic rules and media probes."""

from __future__ import annotations

from pathlib import Path

from app.schemas.coherence import CoherenceSeverity
from app.services.coherence.media import check_media_joins
from app.services.coherence.rules import (
    SegmentView,
    TranscriptWordView,
    check_dangling_starters,
    check_incomplete_endings,
    check_word_cuts,
    run_text_rules,
)


def _seg(
    index: int,
    start: float,
    end: float,
    text: str,
    *,
    gap_before: float = 0.0,
) -> SegmentView:
    return SegmentView(
        index=index,
        uuid=f"seg-{index}",
        start=start,
        end=end,
        text=text,
        gap_before=gap_before,
    )


def test_coherent_join_has_no_text_issues() -> None:
    segments = [
        _seg(1, 10.0, 18.0, "La gracia de Dios es suficiente para todo pecador."),
        _seg(
            2,
            18.2,
            26.0,
            "Cristo es el centro de la predicación y de nuestra esperanza.",
            gap_before=0.2,
        ),
    ]
    issues = run_text_rules(segments, words=[], deleted_context=[""])
    assert issues == []


def test_dangling_por_eso_after_gap() -> None:
    segments = [
        _seg(1, 10.0, 16.0, "Dios ama al mundo y envió a su Hijo."),
        _seg(
            2,
            40.0,
            48.0,
            "Por eso debemos arrepentirnos y creer en el evangelio.",
            gap_before=24.0,
        ),
    ]
    issues = check_dangling_starters(segments)
    assert len(issues) == 1
    assert issues[0].code == "DANGLING_CONNECTOR"
    assert issues[0].segment_id == 2
    assert "por eso" in issues[0].message.lower()
    assert issues[0].recommendation


def test_incomplete_ending_is_blocked() -> None:
    segments = [
        _seg(1, 1.0, 5.0, "La fe viene por el oír y"),
        _seg(2, 20.0, 25.0, "la predicación de Cristo.", gap_before=15.0),
    ]
    issues = check_incomplete_endings(segments)
    assert any(i.code == "INCOMPLETE_ENDING" and i.severity == CoherenceSeverity.blocked for i in issues)


def test_word_cut_is_blocked() -> None:
    words = [TranscriptWordView(start=9.5, end=10.4, text="gracia")]
    segments = [_seg(1, 10.0, 14.0, "gracia de Dios")]
    issues = check_word_cuts(segments, words)
    assert len(issues) == 1
    assert issues[0].code == "WORD_CUT"
    assert issues[0].severity == CoherenceSeverity.blocked


def test_dangling_reference_and_abrupt_topic() -> None:
    segments = [
        _seg(1, 0.0, 6.0, "Pablo escribe a los romanos con claridad."),
        _seg(
            2,
            50.0,
            58.0,
            "Este punto demuestra que la justificación es por fe sola.",
            gap_before=44.0,
        ),
    ]
    deleted = ["Primero el pecado, segundo la ley, tercero la gracia revelada en Cristo."]
    issues = run_text_rules(segments, words=[], deleted_context=deleted)
    codes = {i.code for i in issues}
    assert "DANGLING_REFERENCE" in codes
    assert "ABRUPT_TOPIC_CHANGE" in codes or "ARTIFICIAL_PAUSE" in codes


def test_unanswered_question_at_end() -> None:
    segments = [
        _seg(1, 0.0, 8.0, "¿Quién nos separará del amor de Cristo?"),
    ]
    issues = check_incomplete_endings(segments)
    assert any(i.code == "UNANSWERED_QUESTION" for i in issues)


def test_media_volume_and_framing_jumps(tmp_path: Path) -> None:
    source = tmp_path / "clip.mp4"
    source.write_bytes(b"fake")
    calls = {"n": 0}

    def fake_runner(args: list[str]) -> str:
        calls["n"] += 1
        joined = " ".join(args)
        # Alternate loud / quiet and bright / dark samples.
        if "volumedetect" in joined:
            if calls["n"] == 1:
                return (
                    "mean_volume: -12.0 dB\nmax_volume: -3.0 dB\n"
                    "silence_end: 2.0 | silence_duration: 0.6\n"
                )
            return (
                "mean_volume: -28.0 dB\nmax_volume: -20.0 dB\n"
                "silence_end: 0.55 | silence_duration: 0.55\n"
            )
        if calls["n"] % 2 == 1:
            return "lavfi.signalstats.YAVG=40.0\n"
        return "lavfi.signalstats.YAVG=90.0\n"

    segments = [
        _seg(1, 0.0, 2.0, "uno"),
        _seg(2, 10.0, 12.0, "dos", gap_before=8.0),
    ]
    issues = check_media_joins(segments, source=source, runner=fake_runner)
    codes = {i.code for i in issues}
    assert "VOLUME_JUMP" in codes
    assert "FRAMING_JUMP" in codes
    assert "JOIN_NOISE_OR_SILENCE" in codes
