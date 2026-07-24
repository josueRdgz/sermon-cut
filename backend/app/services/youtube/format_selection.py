"""Build a robust yt-dlp ``-f`` format selector for edit-friendly output.

Priorities: H.264 (avc1) video + AAC/M4A audio in an MP4 container. Falls back
gracefully so a video is still fetched when the exact combination is absent, and
the effective result is later reported from FFprobe.
"""

from __future__ import annotations

# Public quality options exposed to the user. Never defaults to 4K.
QUALITY_720P = "720p"
QUALITY_1080P = "1080p"
QUALITY_BEST = "best"

ALLOWED_QUALITIES: frozenset[str] = frozenset({QUALITY_720P, QUALITY_1080P, QUALITY_BEST})

_HEIGHT_BY_QUALITY: dict[str, int | None] = {
    QUALITY_720P: 720,
    QUALITY_1080P: 1080,
    QUALITY_BEST: None,
}


def normalize_quality(value: str | None, *, default: str = QUALITY_1080P) -> str:
    """Return a supported quality string, falling back to ``default``."""
    if value is None:
        return default
    lowered = value.strip().lower()
    return lowered if lowered in ALLOWED_QUALITIES else default


def build_format_selector(quality: str) -> str:
    """Return a yt-dlp ``-f`` expression with layered fallbacks.

    The chain prefers avc1+m4a in MP4, then any mp4 pair, then any progressive
    mp4, then the best merged output regardless of container.
    """
    height = _HEIGHT_BY_QUALITY.get(quality, 1080)

    if height is None:
        return (
            "bv*[ext=mp4][vcodec^=avc1]+ba[ext=m4a]/"
            "bv*[ext=mp4]+ba[ext=m4a]/"
            "bv*+ba/"
            "b[ext=mp4]/"
            "b/best"
        )

    hcap = f"[height<={height}]"
    return (
        f"bv*{hcap}[ext=mp4][vcodec^=avc1]+ba[ext=m4a]/"
        f"bv*{hcap}[ext=mp4]+ba[ext=m4a]/"
        f"bv*{hcap}+ba/"
        f"b{hcap}[ext=mp4]/"
        f"b{hcap}/"
        "b/best"
    )
