"""Preset tables and pure FFmpeg filter builders for background music.

These helpers never download audio and never talk to commercial catalogues.
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from pathlib import Path

from app.models.background_music import BackgroundMusicPreset, BackgroundMusicScope


@dataclass(frozen=True)
class BackgroundMusicSpec:
    """Resolved bed handed to ``build_render_command``."""

    path: Path
    volume: float
    start_seconds: float
    end_seconds: float | None
    fade_in_seconds: float
    fade_out_seconds: float
    scope: BackgroundMusicScope
    ducking: bool
    target_lufs: float
    true_peak_db: float
    lra: float = 11.0


# Prudent spoken-word defaults (voice stays clearly above the bed).
DEFAULT_TARGET_LUFS = -16.0
DEFAULT_TRUE_PEAK_DB = -1.5
DEFAULT_LRA = 11.0

# sidechaincompress tuned so preaching stays intelligible.
DUCK_THRESHOLD = 0.03
DUCK_RATIO = 7.0
DUCK_ATTACK_MS = 25.0
DUCK_RELEASE_MS = 320.0
# Soft ceiling after the mix to avoid inter-sample peaks into the encoder.
ALIMITER = "alimiter=limit=0.95:attack=5:release=50"


PRESET_VALUES: dict[BackgroundMusicPreset, dict] = {
    BackgroundMusicPreset.none: {
        "scope": BackgroundMusicScope.full_reel,
        "volume": 0.0,
        "fade_in_ms": 0,
        "fade_out_ms": 0,
        "ducking_enabled": False,
        "target_lufs": DEFAULT_TARGET_LUFS,
        "true_peak_db": DEFAULT_TRUE_PEAK_DB,
    },
    BackgroundMusicPreset.end_card_only: {
        "scope": BackgroundMusicScope.end_card_only,
        "volume": 0.40,
        "fade_in_ms": 600,
        "fade_out_ms": 1000,
        "ducking_enabled": False,
        "target_lufs": DEFAULT_TARGET_LUFS,
        "true_peak_db": DEFAULT_TRUE_PEAK_DB,
    },
    BackgroundMusicPreset.very_soft_background: {
        "scope": BackgroundMusicScope.full_reel,
        "volume": 0.10,
        "fade_in_ms": 1500,
        "fade_out_ms": 2000,
        "ducking_enabled": True,
        "target_lufs": DEFAULT_TARGET_LUFS,
        "true_peak_db": DEFAULT_TRUE_PEAK_DB,
    },
}


def _fmt(value: float) -> str:
    return f"{value:.6f}".rstrip("0").rstrip(".") or "0"


def volume_to_db(volume: float) -> float:
    """Linear 0–1 gain → dB (floor at a very quiet level)."""
    v = max(1e-6, min(1.0, volume))
    return 20.0 * math.log10(v)


def build_loudnorm_filter(
    *,
    target_lufs: float = DEFAULT_TARGET_LUFS,
    true_peak_db: float = DEFAULT_TRUE_PEAK_DB,
    lra: float = DEFAULT_LRA,
) -> str:
    """Spoken-word loudnorm; true-peak cap avoids clipping."""
    i = max(-24.0, min(-12.0, target_lufs))
    tp = max(-3.0, min(-0.5, true_peak_db))
    return f"loudnorm=I={_fmt(i)}:TP={_fmt(tp)}:LRA={_fmt(lra)}"


def build_music_prep_filter(
    *,
    input_label: str,
    output_label: str,
    volume: float,
    start_seconds: float,
    end_seconds: float | None,
    fade_in_seconds: float,
    fade_out_seconds: float,
    timeline_seconds: float,
) -> str:
    """Trim / fade / pad one music input to the target timeline length."""
    timeline = max(0.05, timeline_seconds)
    start = max(0.0, start_seconds)
    parts: list[str] = [f"[{input_label}]"]

    if end_seconds is not None and end_seconds > start:
        parts.append(f"atrim={_fmt(start)}:{_fmt(end_seconds)}")
    elif start > 0:
        parts.append(f"atrim=start={_fmt(start)}")
    parts.append("asetpts=PTS-STARTPTS")

    fade_in = max(0.0, min(fade_in_seconds, timeline / 2.0))
    fade_out = max(0.0, min(fade_out_seconds, timeline / 2.0))
    if fade_in > 0:
        parts.append(f"afade=t=in:st=0:d={_fmt(fade_in)}")
    if fade_out > 0:
        fo_start = max(0.0, timeline - fade_out)
        parts.append(f"afade=t=out:st={_fmt(fo_start)}:d={_fmt(fade_out)}")

    vol = max(0.0, min(1.0, volume))
    parts.append(f"volume={_fmt(vol)}")
    parts.append(
        "aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo"
    )
    # Pad (or rely on -stream_loop on the input) then hard-trim to the timeline.
    parts.append(f"apad=whole_dur={_fmt(timeline)}")
    parts.append(f"atrim=0:{_fmt(timeline)}")
    parts.append("asetpts=PTS-STARTPTS")
    return ",".join(parts) + f"[{output_label}]"


def build_ducked_mix_filters(
    *,
    voice_label: str,
    music_label: str,
    output_label: str,
    ducking: bool,
) -> list[str]:
    """Keep voice dominant: optional sidechain ducking then ``amix``."""
    if not ducking:
        # Weights favour voice (~1.0) over a quiet bed (~0.35 of already-low volume).
        return [
            (
                f"[{voice_label}][{music_label}]amix=inputs=2:duration=first:"
                f"dropout_transition=2:normalize=0:weights=1 0.35[{output_label}]"
            )
        ]

    return [
        f"[{voice_label}]asplit=2[bgm_voice][bgm_sc]",
        (
            f"[{music_label}][bgm_sc]sidechaincompress="
            f"threshold={_fmt(DUCK_THRESHOLD)}:ratio={_fmt(DUCK_RATIO)}:"
            f"attack={_fmt(DUCK_ATTACK_MS)}:release={_fmt(DUCK_RELEASE_MS)}:"
            f"level_sc=1:makeup=1[bgm_ducked]"
        ),
        (
            f"[bgm_voice][bgm_ducked]amix=inputs=2:duration=first:"
            f"dropout_transition=2:normalize=0:weights=1 0.45[{output_label}]"
        ),
    ]


def build_background_music_graph(
    *,
    voice_label: str,
    music_input_index: int,
    spec: BackgroundMusicSpec,
    main_duration: float,
    normalize_loudness: bool,
) -> tuple[list[str], str]:
    """Return filter lines and the final audio label for the main timeline.

    Ordering: prepare bed → duck/mix under voice → optional limiter → loudnorm.
    """
    lines: list[str] = []
    lines.append(
        build_music_prep_filter(
            input_label=f"{music_input_index}:a",
            output_label="bgm_raw",
            volume=spec.volume,
            start_seconds=spec.start_seconds,
            end_seconds=spec.end_seconds,
            fade_in_seconds=spec.fade_in_seconds,
            fade_out_seconds=spec.fade_out_seconds,
            timeline_seconds=main_duration,
        )
    )
    lines.extend(
        build_ducked_mix_filters(
            voice_label=voice_label,
            music_label="bgm_raw",
            output_label="bgm_mixed",
            ducking=spec.ducking,
        )
    )
    current = "bgm_mixed"
    # Always limit before loudnorm / encode to reduce clipping risk.
    lines.append(f"[{current}]{ALIMITER}[bgm_limited]")
    current = "bgm_limited"
    if normalize_loudness:
        loud = build_loudnorm_filter(
            target_lufs=spec.target_lufs,
            true_peak_db=spec.true_peak_db,
            lra=spec.lra,
        )
        lines.append(f"[{current}]{loud}[bgm_out]")
        current = "bgm_out"
    return lines, current
