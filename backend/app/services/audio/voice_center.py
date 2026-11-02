"""Mix a right-channel voice toward the center of a stereo pair.

Church recordings often put the pulpit mic on the right and room/ambient on
the left. Mixing a fraction of the right channel into the left recenters the
voice without folding the room into mono.
"""

from __future__ import annotations

DEFAULT_VOICE_CENTER = 0.35


def clamp_voice_center(amount: float | None) -> float:
    if amount is None:
        return 0.0
    return max(0.0, min(1.0, float(amount)))


def voice_center_gains(amount: float | None) -> tuple[float, float]:
    """Return (keep_left, mix_right_into_left) after a 1+g normalize on L."""
    g = clamp_voice_center(amount)
    if g <= 0:
        return (1.0, 0.0)
    keep = 1.0 / (1.0 + g)
    return (keep, g * keep)


def build_voice_center_filter(amount: float | None) -> str | None:
    """FFmpeg ``pan`` that copies voice (R) into L. None when amount is ~0."""
    g = clamp_voice_center(amount)
    if g < 0.01:
        return None
    keep, mix = voice_center_gains(g)
    return f"pan=stereo|c0={keep:.3f}*c0+{mix:.3f}*c1|c1=c1"
