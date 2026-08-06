"""Detect and conceal short digital dropouts in PCM WAV audio.

The detector intentionally targets a narrow, high-confidence failure mode:
consecutive near-zero PCM frames surrounded by audible signal. Natural pauses
and long missing passages are reported for review, never synthesized.
"""

from __future__ import annotations

import math
import shutil
import sys
import threading
import wave
from array import array
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path

from app.core.exceptions import ValidationAppError

ProgressCallback = Callable[[float], None]


@dataclass(frozen=True)
class DropoutIssue:
    """One suspicious near-zero run in the decoded audio."""

    start_seconds: float
    end_seconds: float
    duration_ms: float
    confidence: float
    repairable: bool
    repaired: bool
    kind: str = "digital_dropout"


@dataclass(frozen=True)
class AudioRepairResult:
    """Summary returned after analysis and optional repair."""

    sample_rate: int
    channels: int
    duration_seconds: float
    issues: list[DropoutIssue]
    repaired_count: int


@dataclass(frozen=True)
class _Candidate:
    start_frame: int
    end_frame: int  # exclusive
    left_rms: float
    right_rms: float


def _samples_from_bytes(data: bytes) -> array:
    samples = array("h")
    samples.frombytes(data)
    if sys.byteorder != "little":
        samples.byteswap()
    return samples


def _samples_to_bytes(samples: array) -> bytes:
    if sys.byteorder == "little":
        return samples.tobytes()
    copied = array("h", samples)
    copied.byteswap()
    return copied.tobytes()


def _rms(samples: array) -> float:
    if not samples:
        return 0.0
    return math.sqrt(sum(int(value) * int(value) for value in samples) / len(samples))


def _context_rms(
    reader: wave.Wave_read,
    *,
    start_frame: int,
    end_frame: int,
) -> float:
    if end_frame <= start_frame:
        return 0.0
    reader.setpos(start_frame)
    return _rms(_samples_from_bytes(reader.readframes(end_frame - start_frame)))


def _scan_quiet_runs(
    input_path: Path,
    *,
    silence_threshold: int,
    min_dropout_ms: float,
    max_review_ms: float,
    context_ms: float,
    min_context_rms: float,
    cancel_event: threading.Event | None,
    on_progress: ProgressCallback | None,
) -> tuple[wave._wave_params, list[_Candidate]]:  # type: ignore[attr-defined]
    with wave.open(str(input_path), "rb") as reader:
        params = reader.getparams()
        if params.sampwidth != 2 or params.comptype != "NONE":
            raise ValidationAppError(
                "Audio repair requires uncompressed 16-bit PCM WAV.",
                code="unsupported_repair_audio",
            )
        rate = params.framerate
        channels = params.nchannels
        total_frames = params.nframes
        min_frames = max(1, round(rate * min_dropout_ms / 1000))
        max_frames = max(min_frames, round(rate * max_review_ms / 1000))
        raw_runs: list[tuple[int, int]] = []
        run_start: int | None = None
        frame_index = 0
        chunk_frames = 32_768

        while frame_index < total_frames:
            if cancel_event is not None and cancel_event.is_set():
                raise InterruptedError("Audio repair cancelled")
            frame_count = min(chunk_frames, total_frames - frame_index)
            samples = _samples_from_bytes(reader.readframes(frame_count))
            actual_frames = len(samples) // channels
            for local_frame in range(actual_frames):
                offset = local_frame * channels
                quiet = all(
                    abs(samples[offset + channel]) <= silence_threshold
                    for channel in range(channels)
                )
                absolute_frame = frame_index + local_frame
                if quiet and run_start is None:
                    run_start = absolute_frame
                elif not quiet and run_start is not None:
                    if min_frames <= absolute_frame - run_start <= max_frames:
                        raw_runs.append((run_start, absolute_frame))
                    run_start = None
            frame_index += actual_frames
            if on_progress is not None and total_frames:
                on_progress(min(0.7, 0.7 * frame_index / total_frames))

        if run_start is not None and min_frames <= total_frames - run_start <= max_frames:
            raw_runs.append((run_start, total_frames))

    context_frames = max(1, round(params.framerate * context_ms / 1000))
    candidates: list[_Candidate] = []
    with wave.open(str(input_path), "rb") as reader:
        for start, end in raw_runs:
            if start < context_frames or end + context_frames > params.nframes:
                continue
            left_rms = _context_rms(
                reader,
                start_frame=start - context_frames,
                end_frame=start,
            )
            right_rms = _context_rms(
                reader,
                start_frame=end,
                end_frame=end + context_frames,
            )
            if left_rms >= min_context_rms and right_rms >= min_context_rms:
                candidates.append(
                    _Candidate(
                        start_frame=start,
                        end_frame=end,
                        left_rms=left_rms,
                        right_rms=right_rms,
                    )
                )
    return params, candidates


def _replacement_for(
    reader: wave.Wave_read,
    candidate: _Candidate,
    *,
    channels: int,
) -> array:
    """Blend equally-sized context from both sides into the missing interval."""
    gap_frames = candidate.end_frame - candidate.start_frame
    reader.setpos(candidate.start_frame - gap_frames)
    left = _samples_from_bytes(reader.readframes(gap_frames))
    reader.setpos(candidate.end_frame)
    right = _samples_from_bytes(reader.readframes(gap_frames))
    replacement = array("h", [0]) * (gap_frames * channels)

    for frame in range(gap_frames):
        alpha = (frame + 1) / (gap_frames + 1)
        for channel in range(channels):
            index = frame * channels + channel
            # Mirror both contexts so the first/last generated samples meet the
            # real waveform at each boundary instead of introducing a new click.
            mirrored_index = (gap_frames - 1 - frame) * channels + channel
            value = round(
                (1.0 - alpha) * left[mirrored_index] + alpha * right[mirrored_index]
            )
            replacement[index] = max(-32768, min(32767, value))
    return replacement


def _write_repaired(
    input_path: Path,
    output_path: Path,
    *,
    params: wave._wave_params,  # type: ignore[attr-defined]
    replacements: dict[int, tuple[int, array]],
    cancel_event: threading.Event | None,
    on_progress: ProgressCallback | None,
) -> None:
    output_path.parent.mkdir(parents=True, exist_ok=True)
    temp_path = output_path.with_suffix(".tmp.wav")
    try:
        with wave.open(str(input_path), "rb") as source, wave.open(str(temp_path), "wb") as target:
            target.setparams(params)
            channels = params.nchannels
            frame_index = 0
            chunk_frames = 32_768
            while frame_index < params.nframes:
                if cancel_event is not None and cancel_event.is_set():
                    raise InterruptedError("Audio repair cancelled")
                count = min(chunk_frames, params.nframes - frame_index)
                samples = _samples_from_bytes(source.readframes(count))
                chunk_end = frame_index + len(samples) // channels
                for start, (end, replacement) in replacements.items():
                    if end <= frame_index or start >= chunk_end:
                        continue
                    overlap_start = max(start, frame_index)
                    overlap_end = min(end, chunk_end)
                    source_offset = (overlap_start - start) * channels
                    target_offset = (overlap_start - frame_index) * channels
                    sample_count = (overlap_end - overlap_start) * channels
                    samples[target_offset : target_offset + sample_count] = replacement[
                        source_offset : source_offset + sample_count
                    ]
                target.writeframesraw(_samples_to_bytes(samples))
                frame_index = chunk_end
                if on_progress is not None and params.nframes:
                    on_progress(0.7 + 0.3 * frame_index / params.nframes)
        temp_path.replace(output_path)
    except Exception:
        temp_path.unlink(missing_ok=True)
        raise


def analyze_and_repair_wav(
    input_path: Path,
    output_path: Path,
    *,
    silence_threshold: int = 8,
    min_dropout_ms: float = 2.0,
    max_auto_repair_ms: float = 200.0,
    max_review_ms: float = 250.0,
    context_ms: float = 25.0,
    min_context_rms: float = 160.0,
    cancel_event: threading.Event | None = None,
    on_progress: ProgressCallback | None = None,
) -> AudioRepairResult:
    """Analyze PCM audio and write a conservatively repaired copy."""
    params, candidates = _scan_quiet_runs(
        input_path,
        silence_threshold=silence_threshold,
        min_dropout_ms=min_dropout_ms,
        max_review_ms=max_review_ms,
        context_ms=context_ms,
        min_context_rms=min_context_rms,
        cancel_event=cancel_event,
        on_progress=on_progress,
    )
    rate = params.framerate
    replacements: dict[int, tuple[int, array]] = {}
    issues: list[DropoutIssue] = []

    with wave.open(str(input_path), "rb") as reader:
        for candidate in candidates:
            frame_count = candidate.end_frame - candidate.start_frame
            duration_ms = 1000 * frame_count / rate
            repairable = duration_ms <= max_auto_repair_ms
            repaired = False
            if repairable and candidate.start_frame >= frame_count:
                if candidate.end_frame + frame_count <= params.nframes:
                    replacement = _replacement_for(
                        reader,
                        candidate,
                        channels=params.nchannels,
                    )
                    replacements[candidate.start_frame] = (
                        candidate.end_frame,
                        replacement,
                    )
                    repaired = True
            context_strength = min(candidate.left_rms, candidate.right_rms)
            confidence = min(0.99, 0.72 + min(0.27, context_strength / 12000))
            issues.append(
                DropoutIssue(
                    start_seconds=candidate.start_frame / rate,
                    end_seconds=candidate.end_frame / rate,
                    duration_ms=duration_ms,
                    confidence=confidence,
                    repairable=repairable,
                    repaired=repaired,
                )
            )

    if replacements:
        _write_repaired(
            input_path,
            output_path,
            params=params,
            replacements=replacements,
            cancel_event=cancel_event,
            on_progress=on_progress,
        )
    else:
        output_path.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(input_path, output_path)
        if on_progress is not None:
            on_progress(1.0)

    return AudioRepairResult(
        sample_rate=params.framerate,
        channels=params.nchannels,
        duration_seconds=params.nframes / params.framerate,
        issues=issues,
        repaired_count=sum(issue.repaired for issue in issues),
    )
