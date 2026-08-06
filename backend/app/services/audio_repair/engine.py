"""Detect and conceal short digital dropouts in PCM WAV audio.

The detector intentionally targets a narrow, high-confidence failure mode:
consecutive near-zero PCM frames with *hard* amplitude edges on both sides
(speech abruptly cut to silence). Soft landings into natural micro-pauses are
ignored — repairing those used to inject mirrored speech and sounded like
doubling / extra cuts.

Reconstruction never copies or mirrors neighbouring speech. Short gaps are
filled with a cosine fade through silence so edge clicks disappear without
echoing the surrounding words.
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
    left_edge: float
    right_edge: float


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


def _peak_abs(samples: array) -> float:
    if not samples:
        return 0.0
    return float(max(abs(int(value)) for value in samples))


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


def _context_peak(
    reader: wave.Wave_read,
    *,
    start_frame: int,
    end_frame: int,
) -> float:
    if end_frame <= start_frame:
        return 0.0
    reader.setpos(start_frame)
    return _peak_abs(_samples_from_bytes(reader.readframes(end_frame - start_frame)))


def _merge_runs(
    runs: list[tuple[int, int]],
    *,
    merge_frames: int,
    bridge_peaks: list[float],
    max_bridge_peak: float,
) -> list[tuple[int, int]]:
    """Collapse bursty near-zero islands only when the bridge is also quiet.

    Merging across audible samples glues natural pauses into fake dropouts, so
    the peak of every bridged span must stay near the silence floor.
    """
    if not runs:
        return []
    merged: list[list[int]] = [[runs[0][0], runs[0][1]]]
    for index, (start, end) in enumerate(runs[1:], start=0):
        bridge_peak = bridge_peaks[index]
        if (
            start - merged[-1][1] <= merge_frames
            and bridge_peak <= max_bridge_peak
        ):
            merged[-1][1] = end
        else:
            merged.append([start, end])
    return [(start, end) for start, end in merged]


def _scan_quiet_runs(
    input_path: Path,
    *,
    silence_threshold: int,
    min_dropout_ms: float,
    max_review_ms: float,
    context_ms: float,
    min_context_rms: float,
    edge_ms: float,
    min_edge_peak: float,
    merge_gap_ms: float,
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
        merge_frames = max(0, round(rate * merge_gap_ms / 1000))
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
                    if absolute_frame - run_start >= min_frames:
                        raw_runs.append((run_start, absolute_frame))
                    run_start = None
            frame_index += actual_frames
            if on_progress is not None and total_frames:
                on_progress(min(0.7, 0.7 * frame_index / total_frames))

        if run_start is not None and total_frames - run_start >= min_frames:
            raw_runs.append((run_start, total_frames))

    # Measure bridge peaks between consecutive qualifying runs for safe merges.
    bridge_peaks: list[float] = []
    with wave.open(str(input_path), "rb") as reader:
        for (_, prev_end), (next_start, _) in zip(raw_runs, raw_runs[1:], strict=False):
            if next_start <= prev_end:
                bridge_peaks.append(0.0)
            else:
                bridge_peaks.append(
                    _context_peak(
                        reader,
                        start_frame=prev_end,
                        end_frame=next_start,
                    )
                )

    max_bridge_peak = float(max(silence_threshold * 4, 32))
    merged_runs = _merge_runs(
        raw_runs,
        merge_frames=merge_frames,
        bridge_peaks=bridge_peaks,
        max_bridge_peak=max_bridge_peak,
    )
    sized_runs = [
        (start, end)
        for start, end in merged_runs
        if min_frames <= end - start <= max_frames
    ]

    context_frames = max(1, round(params.framerate * context_ms / 1000))
    edge_frames = max(1, round(params.framerate * edge_ms / 1000))
    candidates: list[_Candidate] = []
    with wave.open(str(input_path), "rb") as reader:
        for start, end in sized_runs:
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
            if left_rms < min_context_rms or right_rms < min_context_rms:
                continue
            # True digital dropouts cut mid-waveform. Soft landings into natural
            # pauses have near-threshold samples on the edges and must be skipped.
            left_edge = _context_peak(
                reader,
                start_frame=start - edge_frames,
                end_frame=start,
            )
            right_edge = _context_peak(
                reader,
                start_frame=end,
                end_frame=end + edge_frames,
            )
            if left_edge < min_edge_peak or right_edge < min_edge_peak:
                continue
            candidates.append(
                _Candidate(
                    start_frame=start,
                    end_frame=end,
                    left_rms=left_rms,
                    right_rms=right_rms,
                    left_edge=left_edge,
                    right_edge=right_edge,
                )
            )
    return params, candidates


def _replacement_for(
    reader: wave.Wave_read,
    candidate: _Candidate,
    *,
    channels: int,
) -> array:
    """Fade through silence between the hard edges — never mirror speech.

    Mirroring neighbouring PCM into the gap re-inserts reversed syllables and
    is what made repairs sound doubled / stuttery. A cosine fade to zero and
    back removes the boundary click without inventing speech content.
    """
    gap_frames = candidate.end_frame - candidate.start_frame
    reader.setpos(candidate.start_frame - 1)
    left = _samples_from_bytes(reader.readframes(1))
    reader.setpos(candidate.end_frame)
    right = _samples_from_bytes(reader.readframes(1))
    replacement = array("h", [0]) * (gap_frames * channels)

    for frame in range(gap_frames):
        # First half decays from the left edge to silence; second half grows
        # from silence to the right edge. No neighbouring speech is copied.
        t = (frame + 1) / (gap_frames + 1)
        if t <= 0.5:
            gain = math.cos(math.pi * t)
            source = left
        else:
            gain = math.cos(math.pi * (1.0 - t))
            source = right
        for channel in range(channels):
            value = round(gain * source[channel])
            replacement[frame * channels + channel] = max(-32768, min(32767, value))
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
    min_context_rms: float = 300.0,
    edge_ms: float = 0.25,
    min_edge_peak: float = 250.0,
    merge_gap_ms: float = 5.0,
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
        edge_ms=edge_ms,
        min_edge_peak=min_edge_peak,
        merge_gap_ms=merge_gap_ms,
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
            if repairable and candidate.start_frame >= 1:
                if candidate.end_frame < params.nframes:
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
            edge_strength = min(candidate.left_edge, candidate.right_edge)
            context_strength = min(candidate.left_rms, candidate.right_rms)
            confidence = min(
                0.99,
                0.70
                + min(0.18, edge_strength / 8000)
                + min(0.11, context_strength / 12000),
            )
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
