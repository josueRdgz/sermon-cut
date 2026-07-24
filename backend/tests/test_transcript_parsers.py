"""Unit tests for transcript parsers using real fixtures and corrupt cases."""

from __future__ import annotations

from pathlib import Path

import pytest
from app.core.exceptions import ValidationAppError
from app.models.transcript import TranscriptSource
from app.services.transcripts import parse_transcript_file
from app.services.transcripts.parse_srt import parse_srt
from app.services.transcripts.parse_vtt import parse_vtt
from app.services.transcripts.timing import parse_timestamp

FIXTURES = Path(__file__).resolve().parent / "fixtures" / "transcripts"


def _read(name: str) -> str:
    return (FIXTURES / name).read_text(encoding="utf-8")


def test_parse_timestamp_srt_and_vtt_styles() -> None:
    assert parse_timestamp("00:00:10,200") == pytest.approx(10.2)
    assert parse_timestamp("00:00:10.200") == pytest.approx(10.2)
    assert parse_timestamp("01:02:03.456") == pytest.approx(3723.456)
    assert parse_timestamp("00:10.500") == pytest.approx(10.5)


def test_parse_sample_srt() -> None:
    source, parsed = parse_transcript_file("sample.srt", _read("sample.srt"))
    assert source is TranscriptSource.uploaded_srt
    assert parsed.has_timing is True
    assert len(parsed.segments) == 3
    assert parsed.segments[0].start == pytest.approx(1.0)
    assert parsed.segments[0].end == pytest.approx(4.5)
    assert parsed.segments[0].text == "Bienvenidos a este mensaje."
    assert parsed.segments[1].text == "Hoy hablaremos de la gracia de Dios."


def test_parse_sample_vtt_strips_tags_preserves_words() -> None:
    source, parsed = parse_transcript_file("sample.vtt", _read("sample.vtt"))
    assert source is TranscriptSource.uploaded_vtt
    assert parsed.segments[0].text == "Bienvenidos a este mensaje."
    assert parsed.segments[2].start == pytest.approx(8.2)


def test_parse_sample_json_with_words() -> None:
    source, parsed = parse_transcript_file("sample.json", _read("sample.json"))
    assert source is TranscriptSource.uploaded_json
    assert parsed.language == "es"
    assert parsed.has_word_timestamps is True
    assert parsed.segments[0].start == pytest.approx(10.2)
    assert parsed.segments[0].words[0].text == "Texto"
    assert parsed.segments[0].words[0].confidence == pytest.approx(0.98)


def test_parse_sample_txt_is_unsynced() -> None:
    source, parsed = parse_transcript_file("sample.txt", _read("sample.txt"))
    assert source is TranscriptSource.uploaded_txt
    assert parsed.has_timing is False
    assert len(parsed.segments) == 3
    assert all(segment.start is None and segment.end is None for segment in parsed.segments)


def test_corrupt_srt_invalid_range() -> None:
    with pytest.raises(ValidationAppError) as exc:
        parse_transcript_file("bad.srt", _read("corrupt_negative_range.srt"))
    assert exc.value.code == "invalid_time_range"


def test_corrupt_srt_overlap() -> None:
    with pytest.raises(ValidationAppError) as exc:
        parse_transcript_file("bad.srt", _read("corrupt_overlap.srt"))
    assert exc.value.code == "overlapping_segments"


def test_corrupt_srt_missing_arrow() -> None:
    with pytest.raises(ValidationAppError) as exc:
        parse_srt(_read("corrupt_missing_arrow.srt"))
    assert exc.value.code == "invalid_srt"


def test_corrupt_vtt_missing_header() -> None:
    with pytest.raises(ValidationAppError) as exc:
        parse_vtt(_read("corrupt.vtt"))
    assert exc.value.code == "invalid_vtt"


def test_untimed_json_marked_without_timing() -> None:
    source, parsed = parse_transcript_file("x.json", _read("minimal_untimed.json"))
    assert source is TranscriptSource.uploaded_json
    assert parsed.has_timing is False
