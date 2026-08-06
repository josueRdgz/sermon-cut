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
    amplitude: float = 8000,
) -> None:
    samples = array("h")
    for frame in range(round(rate * duration)):
        value = round(amplitude * math.sin(2 * math.pi * 220 * frame / rate))
        if gap_start <= frame < gap_start + gap_frames:
            value = 0
        samples.append(value)
    with wave.open(str(path), "wb") as writer:
        writer.setnchannels(1)
        writer.setsampwidth(2)
        writer.setframerate(rate)
        writer.writeframes(samples.tobytes())


def _write_soft_pause(
    path: Path,
    *,
    pause_start: int,
    pause_frames: int,
    rate: int = 16_000,
    duration: float = 1.0,
) -> None:
    """Natural-looking micro-pause: amplitude eases into near-silence."""
    samples = array("h")
    total = round(rate * duration)
    fade = max(1, pause_frames // 2)
    for frame in range(total):
        base = round(4000 * math.sin(2 * math.pi * 180 * frame / rate))
        if pause_start <= frame < pause_start + pause_frames:
            value = 0
        elif pause_start - fade <= frame < pause_start:
            # Soft landing into the pause.
            progress = (pause_start - frame) / fade
            value = round(base * progress * 0.02)  # peak ~80, below hard-edge floor
        elif pause_start + pause_frames < frame <= pause_start + pause_frames + fade:
            progress = (frame - (pause_start + pause_frames)) / fade
            value = round(base * progress * 0.02)
        else:
            value = base
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
        reader.setpos(8159)
        after = array("h")
        after.frombytes(reader.readframes(1))
    # Edges blend from the real waveform; the middle stays near silence
    # (fade-through-zero) instead of mirrored speech.
    assert abs(repaired[0] - before[0]) < 2000
    assert abs(repaired[-1] - after[0]) < 2000
    mid = repaired[len(repaired) // 2]
    assert abs(mid) < abs(before[0]) * 0.35


def test_reports_long_dropout_without_modifying_it(tmp_path: Path) -> None:
    source = tmp_path / "source.wav"
    output = tmp_path / "output.wav"
    _write_tone_with_gap(source, gap_start=6000, gap_frames=1600)  # 100 ms

    result = analyze_and_repair_wav(source, output, max_auto_repair_ms=60)

    assert result.repaired_count == 0
    assert len(result.issues) == 1
    assert result.issues[0].repairable is False
    assert output.read_bytes() == source.read_bytes()


def test_repairs_review_length_when_auto_ceiling_raised(tmp_path: Path) -> None:
    source = tmp_path / "source.wav"
    output = tmp_path / "output.wav"
    _write_tone_with_gap(source, gap_start=6000, gap_frames=1600)  # 100 ms

    result = analyze_and_repair_wav(
        source,
        output,
        max_auto_repair_ms=250,
        max_review_ms=250,
    )

    assert result.repaired_count == 1
    assert result.issues[0].repairable is True
    assert result.issues[0].repaired is True
    assert output.read_bytes() != source.read_bytes()


def test_default_auto_threshold_repairs_up_to_200ms(tmp_path: Path) -> None:
    source = tmp_path / "source.wav"
    output = tmp_path / "output.wav"
    # 180 ms gap at 16 kHz — within the 200 ms default auto ceiling.
    _write_tone_with_gap(source, gap_start=6000, gap_frames=2880)

    result = analyze_and_repair_wav(source, output)

    assert result.repaired_count == 1
    assert result.issues[0].duration_ms == pytest.approx(180.0, abs=0.1)
    assert result.issues[0].repaired is True


def test_ignores_normal_nonzero_audio(tmp_path: Path) -> None:
    source = tmp_path / "source.wav"
    output = tmp_path / "output.wav"
    _write_tone_with_gap(source, gap_start=0, gap_frames=0)

    result = analyze_and_repair_wav(source, output)

    assert result.issues == []
    assert output.read_bytes() == source.read_bytes()


def test_ignores_soft_natural_micro_pauses(tmp_path: Path) -> None:
    """Soft landings into near-silence must not be treated as dropouts."""
    source = tmp_path / "source.wav"
    output = tmp_path / "output.wav"
    _write_soft_pause(source, pause_start=8000, pause_frames=80)  # 5 ms

    result = analyze_and_repair_wav(source, output)

    assert result.issues == []
    assert result.repaired_count == 0
    assert output.read_bytes() == source.read_bytes()


def test_merges_bursty_hard_dropouts(tmp_path: Path) -> None:
    """Two hard zero islands separated by a near-silent blip become one repair."""
    source = tmp_path / "source.wav"
    output = tmp_path / "output.wav"
    rate = 16_000
    samples = array("h")
    for frame in range(rate):
        value = round(8000 * math.sin(2 * math.pi * 220 * frame / rate))
        # 8 ms zero, 2 ms near-silent bridge, 8 ms zero.
        if 8000 <= frame < 8128 or 8160 <= frame < 8288:
            value = 0
        elif 8128 <= frame < 8160:
            value = 4 if value >= 0 else -4
        samples.append(value)
    with wave.open(str(source), "wb") as writer:
        writer.setnchannels(1)
        writer.setsampwidth(2)
        writer.setframerate(rate)
        writer.writeframes(samples.tobytes())

    result = analyze_and_repair_wav(source, output)

    assert len(result.issues) == 1
    assert result.repaired_count == 1
    # Merged span covers both islands (~18 ms).
    assert result.issues[0].duration_ms == pytest.approx(18.0, abs=0.5)


def test_repair_does_not_mirror_neighbouring_speech(tmp_path: Path) -> None:
    source = tmp_path / "source.wav"
    output = tmp_path / "output.wav"
    gap_start = 8000
    gap_frames = 320  # 20 ms at 16 kHz
    _write_tone_with_gap(source, gap_start=gap_start, gap_frames=gap_frames)

    analyze_and_repair_wav(source, output)

    with wave.open(str(source), "rb") as reader:
        reader.setpos(gap_start - gap_frames)
        left = array("h")
        left.frombytes(reader.readframes(gap_frames))
    with wave.open(str(output), "rb") as reader:
        reader.setpos(gap_start)
        repaired = array("h")
        repaired.frombytes(reader.readframes(gap_frames))

    mirrored = array("h", reversed(left))
    # Correlation with time-reversed left context must stay low (old algo ~0.5+).
    mean_r = sum(repaired) / len(repaired)
    mean_m = sum(mirrored) / len(mirrored)
    num = sum((a - mean_r) * (b - mean_m) for a, b in zip(repaired, mirrored, strict=True))
    den = math.sqrt(
        sum((a - mean_r) ** 2 for a in repaired) * sum((b - mean_m) ** 2 for b in mirrored)
    )
    corr = num / (den + 1e-9)
    assert corr < 0.35
