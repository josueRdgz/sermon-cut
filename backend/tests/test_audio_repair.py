"""Tests for conservative digital-dropout detection and repair."""

from __future__ import annotations

import math
import wave
from array import array
from pathlib import Path

import pytest
from app.services.audio_repair.engine import analyze_and_repair_wav


def _write_tone_with_gap(
    path: Path,
    *,
    gap_start: int,
    gap_frames: int,
    rate: int = 16_000,
    duration: float = 1.0,
) -> None:
    samples = array("h")
    for frame in range(round(rate * duration)):
        value = round(8000 * math.sin(2 * math.pi * 220 * frame / rate))
        if gap_start <= frame < gap_start + gap_frames:
            value = 0
        samples.append(value)
    with wave.open(str(path), "wb") as writer:
        writer.setnchannels(1)
        writer.setsampwidth(2)
        writer.setframerate(rate)
        writer.writeframes(samples.tobytes())


def test_detects_and_repairs_short_digital_dropout(tmp_path: Path) -> None:
    source = tmp_path / "source.wav"
    output = tmp_path / "output.wav"
    _write_tone_with_gap(source, gap_start=8000, gap_frames=160)  # 10 ms

    result = analyze_and_repair_wav(source, output)

    assert result.repaired_count == 1
    assert len(result.issues) == 1
    assert result.issues[0].start_seconds == pytest.approx(0.5, abs=0.001)
    assert result.issues[0].duration_ms == pytest.approx(10.0, abs=0.1)
    with wave.open(str(output), "rb") as reader:
        reader.setpos(7999)
        before = array("h")
        before.frombytes(reader.readframes(1))
        reader.setpos(8000)
        repaired = array("h")
        repaired.frombytes(reader.readframes(160))
    assert any(sample != 0 for sample in repaired)
    assert abs(repaired[0] - before[0]) < 2000


def test_reports_long_dropout_without_modifying_it(tmp_path: Path) -> None:
    source = tmp_path / "source.wav"
    output = tmp_path / "output.wav"
    _write_tone_with_gap(source, gap_start=6000, gap_frames=1600)  # 100 ms

    result = analyze_and_repair_wav(source, output, max_auto_repair_ms=60)

    assert result.repaired_count == 0
    assert len(result.issues) == 1
    assert result.issues[0].repairable is False
    assert output.read_bytes() == source.read_bytes()


def test_ignores_normal_nonzero_audio(tmp_path: Path) -> None:
    source = tmp_path / "source.wav"
    output = tmp_path / "output.wav"
    _write_tone_with_gap(source, gap_start=0, gap_frames=0)

    result = analyze_and_repair_wav(source, output)

    assert result.issues == []
    assert output.read_bytes() == source.read_bytes()
