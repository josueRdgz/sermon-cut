"""Render title-card PNGs for text overlays."""

from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

_REGULAR_FONTS = (
    "/System/Library/Fonts/HelveticaNeue.ttc",
    "/System/Library/Fonts/Supplemental/Arial.ttf",
    "/Library/Fonts/Arial.ttf",
    r"C:\Windows\Fonts\arial.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
)


def _font(size: int) -> ImageFont.ImageFont:
    for candidate in _REGULAR_FONTS:
        path = Path(candidate)
        if path.is_file():
            try:
                return ImageFont.truetype(str(path), size=size)
            except OSError:
                continue
    return ImageFont.load_default()


def render_title_card(
    text: str,
    destination: Path,
    *,
    width: int = 1080,
    height: int = 400,
) -> Path:
    """Write a transparent PNG with centered white text and a soft panel."""
    destination.parent.mkdir(parents=True, exist_ok=True)
    image = Image.new("RGBA", (width, height), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)

    margin = int(width * 0.06)
    panel = (margin, int(height * 0.18), width - margin, int(height * 0.82))
    draw.rounded_rectangle(panel, radius=28, fill=(15, 23, 42, 200))

    content = (text or "").strip() or " "
    font_size = max(28, min(72, int(width * 0.045)))
    font = _font(font_size)

    # Simple wrap by characters for long titles.
    max_chars = max(12, width // max(font_size // 2, 1))
    words = content.split()
    lines: list[str] = []
    current = ""
    for word in words:
        trial = f"{current} {word}".strip()
        if len(trial) <= max_chars:
            current = trial
        else:
            if current:
                lines.append(current)
            current = word
    if current:
        lines.append(current)
    lines = lines[:4] or [content[:max_chars]]

    line_height = font_size + 10
    total_h = line_height * len(lines)
    y = (height - total_h) // 2
    for line in lines:
        bbox = draw.textbbox((0, 0), line, font=font)
        tw = bbox[2] - bbox[0]
        x = (width - tw) // 2
        draw.text((x, y), line, font=font, fill=(255, 255, 255, 255))
        y += line_height

    image.save(destination, format="PNG")
    return destination
