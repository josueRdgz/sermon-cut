"""Detect and conceal short digital dropouts in PCM WAV audio.

The detector intentionally targets a narrow, high-confidence failure mode:
consecutive near-zero PCM frames with *hard* amplitude edges on both sides
(speech abruptly cut to silence). Soft landings into natural micro-pauses are
ignored.

Reconstruction keeps duration (video sync). Short holes use a smoothstep bridge
between the real edge samples (no tangent overshoot). Longer holes conceal with
a short mirrored neighbourhood on each side plus a ducked center — never a
full-phrase mirror and never an exploding Hermite through silence.
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


def _tighten_run_to_floor(
    reader: wave.Wave_read,
    *,
    start_frame: int,
    end_frame: int,
    channels: int,
    floor: int,
) -> tuple[int, int] | None:
    """Shrink a loose quiet run to the true near-zero core.

    A high AAC silence floor can swallow soft landings into the run. Tightening
    restores the real digi-cut boundaries (or empties soft natural pauses).
    """
    if end_frame <= start_frame:
        return None
    reader.setpos(start_frame)
    samples = _samples_from_bytes(reader.readframes(end_frame - start_frame))
    frame_count = len(samples) // channels
    if frame_count <= 0:
        return None

    def frame_quiet(index: int) -> bool:
        offset = index * channels
        mean_abs = sum(abs(samples[offset + channel]) for channel in range(channels)) / channels
        return mean_abs <= floor

    islands: list[tuple[int, int]] = []
    island_start: int | None = None
    for index in range(frame_count):
        if frame_quiet(index):
            if island_start is None:
                island_start = index
        elif island_start is not None:
            islands.append((island_start, index))
            island_start = None
    if island_start is not None:
        islands.append((island_start, frame_count))
    if not islands:
        return None
    best_start, best_end = max(islands, key=lambda pair: pair[1] - pair[0])
    return start_frame + best_start, start_frame + best_end


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
                # Mean across channels: real stereo AAC often leaves residual on
                # only one channel, so requiring *all* channels ≤ threshold misses
                # the dropout entirely.
                mean_abs = sum(
                    abs(samples[offset + channel]) for channel in range(channels)
                ) / channels
                quiet = mean_abs <= silence_threshold
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
    # Core floor catches AAC residual (~25–50) but leaves soft landings (~80+)
    # outside so natural pauses still fail the hard-edge check.
    core_floor = max(24, min(48, silence_threshold // 2))
    short_ms = 40.0
    candidates: list[_Candidate] = []
    with wave.open(str(input_path), "rb") as reader:
        for start, end in sized_runs:
            tightened = _tighten_run_to_floor(
                reader,
                start_frame=start,
                end_frame=end,
                channels=params.nchannels,
                floor=core_floor,
            )
            if tightened is None:
                continue
            start, end = tightened
            frame_count = end - start
            if frame_count < min_frames or frame_count > max_frames:
                continue
            # Short digi-glitches only need a tiny neighborhood (1–5 ms).
            duration_ms = 1000.0 * frame_count / params.framerate
            local_context = (
                max(1, round(params.framerate * 0.005))
                if duration_ms <= short_ms
                else context_frames
            )
            if start < local_context or end + local_context > params.nframes:
                continue
            left_rms = _context_rms(
                reader,
                start_frame=start - local_context,
                end_frame=start,
            )
            right_rms = _context_rms(
                reader,
                start_frame=end,
                end_frame=end + local_context,
            )
            min_rms = 80.0 if duration_ms <= short_ms else min_context_rms
            if left_rms < min_rms or right_rms < min_rms:
                continue
            gap_peak = _context_peak(
                reader,
                start_frame=start,
                end_frame=end,
            )
            local_edge = max(1, edge_frames if duration_ms > short_ms else round(params.framerate * 0.002))
            left_edge = _context_peak(
                reader,
                start_frame=start - local_edge,
                end_frame=start,
            )
            right_edge = _context_peak(
                reader,
                start_frame=end,
                end_frame=end + local_edge,
            )
            # Short clicks: require loud neighbors relative to the hole.
            # Longer holes keep the stricter hard-edge floor.
            if duration_ms <= short_ms:
                edge_floor = max(200.0, gap_peak * 3.0)
            else:
                edge_floor = max(min_edge_peak, gap_peak * 3.0, float(core_floor * 4))
            if left_edge < edge_floor or right_edge < edge_floor:
                continue
            # Soft natural pause: amplitude eases down before the hole. Digi-cuts
            # stay loud until the boundary.
            near_frames = max(local_edge, round(params.framerate * 0.005))
            far_frames = max(near_frames * 2, round(params.framerate * 0.025))
            if start >= far_frames and end + far_frames <= params.nframes:
                left_near = _context_peak(
                    reader,
                    start_frame=start - near_frames,
                    end_frame=start,
                )
                left_far = _context_peak(
                    reader,
                    start_frame=start - far_frames,
                    end_frame=start - near_frames,
                )
                right_near = _context_peak(
                    reader,
                    start_frame=end,
                    end_frame=end + near_frames,
                )
                right_far = _context_peak(
                    reader,
                    start_frame=end + near_frames,
                    end_frame=end + far_frames,
                )
                soft_left = left_far > 400 and left_near < left_far * 0.25
                soft_right = right_far > 400 and right_near < right_far * 0.25
                if soft_left or soft_right:
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


def _smoothstep(y0: float, y1: float, t: float) -> float:
    """Cubic ease between endpoints with zero end slopes (no overshoot)."""
    t = max(0.0, min(1.0, t))
    ease = t * t * (3.0 - 2.0 * t)
    return y0 + (y1 - y0) * ease


def _clamp_pcm(value: float) -> int:
    return max(-32768, min(32767, round(value)))


def _replacement_for(
    reader: wave.Wave_read,
    candidate: _Candidate,
    *,
    channels: int,
    sample_rate: int,
) -> array:
    """Reconstruct the missing interval so the audible cut disappears.

    Short gaps (≤20 ms): smoothstep between the real edge samples — continuous,
    no Hermite tangent blow-up.

    Longer gaps: conceal with a short (≤15 ms) time-reversed neighbourhood on
    each side and a ducked smoothstep in any remaining center. Never mirrors a
    full neighbouring phrase (that doubled speech).
    """
    gap_frames = candidate.end_frame - candidate.start_frame
    if gap_frames <= 0:
        return array("h")

    total_frames = reader.getnframes()
    reader.setpos(max(0, candidate.start_frame - 1))
    left_edge_block = _samples_from_bytes(reader.readframes(1))
    reader.setpos(min(candidate.end_frame, total_frames - 1))
    right_edge_block = _samples_from_bytes(reader.readframes(1))
    if len(left_edge_block) < channels or len(right_edge_block) < channels:
        return array("h", [0]) * (gap_frames * channels)

    short_limit = max(1, round(sample_rate * 0.020))
    replacement = array("h", [0]) * (gap_frames * channels)

    if gap_frames <= short_limit:
        for frame in range(gap_frames):
            t = (frame + 1) / (gap_frames + 1)
            for channel in range(channels):
                y0 = float(left_edge_block[channel])
                y1 = float(right_edge_block[channel])
                replacement[frame * channels + channel] = _clamp_pcm(_smoothstep(y0, y1, t))
        return replacement

    mirror_frames = min(
        gap_frames // 2,
        max(1, round(sample_rate * 0.015)),
        candidate.start_frame,
        max(0, total_frames - candidate.end_frame),
    )
    left_ctx = array("h")
    right_ctx = array("h")
    if mirror_frames > 0:
        reader.setpos(candidate.start_frame - mirror_frames)
        left_ctx = _samples_from_bytes(reader.readframes(mirror_frames))
        reader.setpos(candidate.end_frame)
        right_ctx = _samples_from_bytes(reader.readframes(mirror_frames))

    left_len = len(left_ctx) // channels
    right_len = len(right_ctx) // channels
    crossfade = max(1, min(mirror_frames, round(sample_rate * 0.004), gap_frames // 4))

    for frame in range(gap_frames):
        t = (frame + 1) / (gap_frames + 1)
        duck = 1.0 - 0.88 * math.sin(math.pi * t) ** 2
        for channel in range(channels):
            y0 = float(left_edge_block[channel])
            y1 = float(right_edge_block[channel])
            base = _smoothstep(y0, y1, t) * duck

            left_v: float | None = None
            right_v: float | None = None
            if left_len > 0 and frame < left_len:
                src = (left_len - 1 - frame) * channels + channel
                left_v = float(left_ctx[src])
            if right_len > 0 and frame >= gap_frames - right_len:
                rev = gap_frames - 1 - frame
                src = rev * channels + channel
                if 0 <= src < len(right_ctx):
                    right_v = float(right_ctx[src])

            if left_v is not None and right_v is not None:
                fade = (frame + 1) / (gap_frames + 1)
                value = left_v * (1.0 - fade) + right_v * fade
            elif left_v is not None:
                if frame >= left_len - crossfade:
                    fade = (frame - (left_len - crossfade) + 1) / (crossfade + 1)
                    value = left_v * (1.0 - fade) + base * fade
                else:
                    value = left_v
            elif right_v is not None:
                idx = frame - (gap_frames - right_len)
                if idx < crossfade:
                    fade = (idx + 1) / (crossfade + 1)
                    value = base * (1.0 - fade) + right_v * fade
                else:
                    value = right_v
            else:
                value = base
            replacement[frame * channels + channel] = _clamp_pcm(value)
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
    # Real extracted PCM (AAC→WAV) often sits well above exact zero.
    silence_threshold: int = 64,
    # Below ~1 ms, near-zero samples are usually waveform zero-crossings.
    # Real digi-glitch plateaus in damaged sermon AAC sit above this.
    min_dropout_ms: float = 1.0,
    max_auto_repair_ms: float = 200.0,
    max_review_ms: float = 250.0,
    context_ms: float = 25.0,
    min_context_rms: float = 140.0,
    edge_ms: float = 1.0,
    min_edge_peak: float = 100.0,
    merge_gap_ms: float = 2.0,
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
                        sample_rate=rate,
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
