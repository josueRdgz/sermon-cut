"""Render title-card PNGs for text overlays."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from PIL import Image, ImageDraw, ImageFont

from app.services.subtitles.fonts import pick_face

_REGULAR_FONTS = (
    "/System/Library/Fonts/HelveticaNeue.ttc",
    "/System/Library/Fonts/Supplemental/Arial.ttf",
    "/Library/Fonts/Arial.ttf",
    r"C:\Windows\Fonts\arial.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
)

DEFAULT_TEXT_STYLE = {
    "font_family": "Helvetica Neue",
    "font_size": 52,
    "bold": False,
    "italic": False,
    "underline": False,
    "strikethrough": False,
}


def parse_text_style(style_json: str | None) -> dict[str, Any]:
    style = dict(DEFAULT_TEXT_STYLE)
    if not style_json:
        return style
    try:
        data = json.loads(style_json)
    except json.JSONDecodeError:
        return style
    if not isinstance(data, dict):
        return style
    family = data.get("font_family")
    if isinstance(family, str) and family.strip():
        style["font_family"] = family.strip()
    size = data.get("font_size")
    if isinstance(size, (int, float)) and size > 0:
        style["font_size"] = int(max(20, min(400, size)))
    for key in ("bold", "italic", "underline", "strikethrough"):
        value = data.get(key)
        if isinstance(value, bool):
            style[key] = value
    return style


def _fallback_font(size: int) -> ImageFont.ImageFont:
    for candidate in _REGULAR_FONTS:
        path = Path(candidate)
        if path.is_file():
            try:
                return ImageFont.truetype(str(path), size=size)
            except OSError:
                continue
    return ImageFont.load_default()


def _font_for_style(style: dict[str, Any]) -> ImageFont.ImageFont:
    size = int(style["font_size"])
    face = pick_face(
        str(style["font_family"]),
        bold=bool(style["bold"]),
        italic=bool(style["italic"]),
    )
    if face is not None:
        try:
            return ImageFont.truetype(str(face.path), size=size, index=face.index)
        except OSError:
            try:
                return ImageFont.truetype(str(face.path), size=size)
            except OSError:
                pass
    return _fallback_font(size)


def render_title_card(
    text: str,
    destination: Path,
    *,
    width: int = 1080,
    height: int = 400,
    style_json: str | None = None,
) -> Path:
    """Write a transparent PNG with centered white text and a soft panel."""
    destination.parent.mkdir(parents=True, exist_ok=True)
    style = parse_text_style(style_json)
    image = Image.new("RGBA", (width, height), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)

    margin = int(width * 0.06)
    panel = (margin, int(height * 0.18), width - margin, int(height * 0.82))
    draw.rounded_rectangle(panel, radius=28, fill=(15, 23, 42, 200))

    content = (text or "").strip() or " "
    font_size = int(style["font_size"])
    font = _font_for_style(style)

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
    fill = (255, 255, 255, 255)
    for line in lines:
        bbox = draw.textbbox((0, 0), line, font=font)
        tw = bbox[2] - bbox[0]
        x = (width - tw) // 2
        draw.text((x, y), line, font=font, fill=fill)
        if style["underline"] or style["strikethrough"]:
            x0, x1 = x, x + tw
            if style["underline"]:
                uy = y + font_size + 2
                draw.line((x0, uy, x1, uy), fill=fill, width=max(2, font_size // 18))
            if style["strikethrough"]:
                sy = y + font_size // 2
                draw.line((x0, sy, x1, sy), fill=fill, width=max(2, font_size // 18))
        y += line_height

    image.save(destination, format="PNG")
    return destination
