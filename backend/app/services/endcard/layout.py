"""Text fitting and safe-area geometry for the end card.

Pure geometry/typography helpers: no Pillow drawing here, so wrapping rules can
be tested with a trivial measuring function instead of real font metrics.
"""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass

# Fraction of the canvas kept free on each edge so nothing lands under the
# platform UI of Shorts / Reels (captions, buttons, profile row).
SAFE_MARGIN_X = 0.08
SAFE_TOP = 0.10
SAFE_BOTTOM = 0.16

# Measures the pixel width of a string for a given font size.
Measurer = Callable[[str, int], int]


@dataclass(frozen=True)
class SafeArea:
    """Usable rectangle inside the canvas."""

    left: int
    top: int
    right: int
    bottom: int

    @property
    def width(self) -> int:
        return max(0, self.right - self.left)

    @property
    def height(self) -> int:
        return max(0, self.bottom - self.top)

    @property
    def center_x(self) -> int:
        return (self.left + self.right) // 2


@dataclass(frozen=True)
class FittedText:
    """Result of fitting a string into a bounded box."""

    lines: list[str]
    font_size: int
    truncated: bool

    @property
    def text(self) -> str:
        return "\n".join(self.lines)


def safe_area(width: int, height: int) -> SafeArea:
    """Return the safe rectangle for a canvas, avoiding platform overlays."""
    margin_x = round(width * SAFE_MARGIN_X)
    return SafeArea(
        left=margin_x,
        top=round(height * SAFE_TOP),
        right=width - margin_x,
        bottom=height - round(height * SAFE_BOTTOM),
    )


def wrap_text(text: str, *, max_width: int, font_size: int, measure: Measurer) -> list[str]:
    """Greedy word wrap. Words longer than the box are split character-wise."""
    words = text.split()
    if not words:
        return []

    lines: list[str] = []
    current = ""
    for word in words:
        candidate = word if not current else f"{current} {word}"
        if measure(candidate, font_size) <= max_width:
            current = candidate
            continue
        if current:
            lines.append(current)
            current = ""
        # A single word that cannot fit is broken up rather than overflowing.
        if measure(word, font_size) > max_width:
            chunk = ""
            for char in word:
                probe = chunk + char
                if measure(probe, font_size) <= max_width or not chunk:
                    chunk = probe
                else:
                    lines.append(chunk)
                    chunk = char
            current = chunk
        else:
            current = word
    if current:
        lines.append(current)
    return lines


def fit_text(
    text: str,
    *,
    max_width: int,
    max_height: int,
    max_lines: int,
    font_size: int,
    measure: Measurer,
    min_font_size: int = 18,
    line_spacing: float = 1.22,
) -> FittedText:
    """Shrink the font until the text fits the box, then hard-clamp with an ellipsis.

    Titles wrap onto several lines automatically; text can never overflow because
    the last resort truncates and appends an ellipsis.
    """
    cleaned = " ".join(text.split())
    if not cleaned:
        return FittedText(lines=[], font_size=font_size, truncated=False)

    # A requested size below the floor is itself the floor.
    min_font_size = min(min_font_size, font_size)

    size = font_size
    while size >= min_font_size:
        lines = wrap_text(cleaned, max_width=max_width, font_size=size, measure=measure)
        line_height = round(size * line_spacing)
        fits_height = line_height * len(lines) <= max_height
        if len(lines) <= max_lines and fits_height:
            return FittedText(lines=lines, font_size=size, truncated=False)
        size -= 2

    # Smallest allowed size: keep only what fits and mark the cut with "…".
    size = min_font_size
    lines = wrap_text(cleaned, max_width=max_width, font_size=size, measure=measure)
    line_height = round(size * line_spacing)
    allowed = max(1, min(max_lines, max_height // max(1, line_height)))
    kept = lines[:allowed]
    if len(lines) > allowed and kept:
        kept[-1] = _with_ellipsis(kept[-1], max_width=max_width, font_size=size, measure=measure)
    return FittedText(lines=kept, font_size=size, truncated=len(lines) > allowed)


def _with_ellipsis(line: str, *, max_width: int, font_size: int, measure: Measurer) -> str:
    candidate = f"{line}…"
    while measure(candidate, font_size) > max_width and len(candidate) > 1:
        # Drop the char before the ellipsis until it fits.
        candidate = candidate[:-2] + "…"
    return candidate


def clamp_duration(seconds: float, *, minimum: float, maximum: float) -> float:
    """Clamp the end card duration into the allowed window."""
    return round(min(max(seconds, minimum), maximum), 3)
