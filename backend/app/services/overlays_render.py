"""Rasterize title-card overlays locally with Pillow (no browser)."""

from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

_REGULAR_FONTS = (
    "/System/Library/Fonts/HelveticaNeue.ttc",
    "/System/Library/Fonts/Helvetica.ttc",
    "/System/Library/Fonts/Supplemental/Arial.ttf",
    "/Library/Fonts/Arial.ttf",
    r"C:\Windows\Fonts\arial.ttf",
    r"C:\Windows\Fonts\segoeui.ttf",
    "/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
    "/usr/share/fonts/TTF/DejaVuSans.ttf",
    "/usr/share/fonts/truetype/freefont/FreeSans.ttf",
)


def _load_font(size: int) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    for candidate in _REGULAR_FONTS:
        path = Path(candidate)
        if not path.is_file():
            continue
        try:
            return ImageFont.truetype(str(path), size=size)
        except OSError:
            continue
    return ImageFont.load_default()


def _wrap(draw: ImageDraw.ImageDraw, text: str, font: ImageFont.ImageFont, max_width: int) -> str:
    words = (text or "").strip().split()
    if not words:
        return "Texto"
    lines: list[str] = []
    current = words[0]
    for word in words[1:]:
        trial = f"{current} {word}"
        if draw.textlength(trial, font=font) <= max_width:
            current = trial
        else:
            lines.append(current)
            current = word
    lines.append(current)
    return "\n".join(lines[:8])


def render_title_card(
    text: str,
    dest: Path,
    width: int = 640,
    height: int = 240,
) -> Path:
    """Write a rounded translucent PNG with the overlay title text."""
    dest.parent.mkdir(parents=True, exist_ok=True)
    canvas = Image.new("RGBA", (width, height), (0, 0, 0, 0))
    draw = ImageDraw.Draw(canvas)
    font = _load_font(max(28, height // 6))
    inner = (16, 16, width - 16, height - 16)
    draw.rounded_rectangle(inner, radius=18, fill=(15, 23, 42, 200))
    wrapped = _wrap(draw, text, font, width - 64)
    bbox = draw.multiline_textbbox((0, 0), wrapped, font=font, align="center", spacing=6)
    text_w = bbox[2] - bbox[0]
    text_h = bbox[3] - bbox[1]
    draw.multiline_text(
        ((width - text_w) / 2 - bbox[0], (height - text_h) / 2 - bbox[1]),
        wrapped,
        font=font,
        fill=(248, 250, 252, 255),
        align="center",
        spacing=6,
    )
    canvas.save(dest, format="PNG")
    return dest
