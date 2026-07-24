"""Intensity presets for optional technical cut suggestions.

Conservative is the default for sermons: keep natural breathing room and avoid
aggressive filler removal that could distort meaning or delivery.
"""

from __future__ import annotations

from dataclasses import dataclass

from app.schemas.cut_suggestions import CutIntensity


@dataclass(frozen=True)
class IntensityProfile:
    """Thresholds that control how bold suggestions may be."""

    min_silence_duration: float
    """Minimum silence length (s) worth suggesting a reduction for."""

    keep_margin: float
    """Natural pad kept before/after speech so breaths are not clipped."""

    residual_silence: float
    """Silence left after a reduction (never collapse to a hard zero gap)."""

    min_long_pause: float
    """Internal pause length flagged as a long pause."""

    crossfade_ms: int
    """Short crossfade applied when accepting an internal cut."""

    max_per_segment: int
    noise_db: float
    silence_min_detect: float
    """FFmpeg silencedetect minimum duration."""

    suggest_fillers: bool
    allow_contextual_fillers: bool
    """If True, may suggest «este» / «pues» only with hesitation context."""

    filler_pause_around: float
    """Require nearby pause (s) before treating a token as a filler."""

    min_filler_duration: float
    min_safe_kept_duration: float
    """Refuse cuts that would leave a fragment shorter than this."""


PROFILES: dict[CutIntensity, IntensityProfile] = {
    CutIntensity.conservative: IntensityProfile(
        min_silence_duration=0.90,
        keep_margin=0.28,
        residual_silence=0.35,
        min_long_pause=1.50,
        crossfade_ms=220,
        max_per_segment=3,
        noise_db=-35.0,
        silence_min_detect=0.30,
        suggest_fillers=True,
        allow_contextual_fillers=False,
        filler_pause_around=0.35,
        min_filler_duration=0.12,
        min_safe_kept_duration=1.20,
    ),
    CutIntensity.balanced: IntensityProfile(
        min_silence_duration=0.55,
        keep_margin=0.18,
        residual_silence=0.25,
        min_long_pause=1.00,
        crossfade_ms=180,
        max_per_segment=5,
        noise_db=-35.0,
        silence_min_detect=0.25,
        suggest_fillers=True,
        allow_contextual_fillers=True,
        filler_pause_around=0.25,
        min_filler_duration=0.10,
        min_safe_kept_duration=0.90,
    ),
    CutIntensity.aggressive: IntensityProfile(
        min_silence_duration=0.35,
        keep_margin=0.12,
        residual_silence=0.15,
        min_long_pause=0.70,
        crossfade_ms=120,
        max_per_segment=8,
        noise_db=-32.0,
        silence_min_detect=0.20,
        suggest_fillers=True,
        allow_contextual_fillers=True,
        filler_pause_around=0.15,
        min_filler_duration=0.08,
        min_safe_kept_duration=0.70,
    ),
}


def get_profile(intensity: CutIntensity | str) -> IntensityProfile:
    key = CutIntensity(intensity)
    return PROFILES[key]
