"""Render the end card as a PNG with Pillow.

No browser and no headless rendering engine: the card is composed directly with
Pillow, so it works offline on any machine. Fonts come from the same
system-installed set used for subtitles (never downloaded).
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont

from app.models.end_card import CALL_TO_ACTION_TEXT, EndCardLayout
from app.services.endcard.layout import FittedText, SafeArea, fit_text, safe_area

logger = logging.getLogger(__name__)

# Candidate system font files, in preference order (macOS / Windows / Linux).
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
_SERIF_FONTS = (
    "/System/Library/Fonts/Supplemental/Georgia.ttf",
    "/Library/Fonts/Georgia.ttf",
    "/System/Library/Fonts/NewYork.ttf",
    r"C:\Windows\Fonts\georgia.ttf",
    "/usr/share/fonts/truetype/liberation/LiberationSerif-Regular.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSerif.ttf",
    "/usr/share/fonts/TTF/DejaVuSerif.ttf",
)

_TEXT_COLOR = (255, 255, 255, 255)
_MUTED_COLOR = (222, 228, 236, 255)
_ACCENT_COLOR = (147, 197, 253, 255)
_CARD_BG = (15, 23, 42, 255)
_CARD_PANEL = (30, 41, 59, 255)

# Gaps between the stacked paragraphs, as a fraction of the canvas height.
_GAP_AFTER_TITLE = 0.025
_GAP_AFTER_CTA = 0.020
_GAP_AFTER_IDENTITY = 0.012
_GAP_RATIO_TOTAL = _GAP_AFTER_TITLE + _GAP_AFTER_CTA + _GAP_AFTER_IDENTITY


@dataclass(frozen=True)
class EndCardContent:
    """Everything printed on the card."""

    sermon_title: str
    church_name: str
    channel_handle: str
    call_to_action: str = CALL_TO_ACTION_TEXT
    url_text: str | None = None
    cover_path: Path | None = None
    logo_path: Path | None = None
    qr_url: str | None = None


def _load_font(size: int, *, serif: bool = False, bold: bool = False) -> ImageFont.FreeTypeFont:
    candidates = _SERIF_FONTS + _REGULAR_FONTS if serif else _REGULAR_FONTS
    for path in candidates:
        source = Path(path)
        if not source.is_file():
            continue
        try:
            # .ttc collections: index 1 is usually the bold face.
            index = 1 if bold and source.suffix.lower() == ".ttc" else 0
            return ImageFont.truetype(str(source), size=size, index=index)
        except OSError:
            continue
    logger.warning("No system TrueType font found; falling back to Pillow default")
    return ImageFont.load_default(size=size)


def _measurer(*, serif: bool = False, bold: bool = False):
    """Build a width measurer bound to a font family for ``fit_text``."""

    def measure(text: str, font_size: int) -> int:
        font = _load_font(font_size, serif=serif, bold=bold)
        return int(round(font.getlength(text)))

    return measure


def _draw_centered_block(
    draw: ImageDraw.ImageDraw,
    fitted: FittedText,
    *,
    center_x: int,
    top: int,
    color: tuple[int, int, int, int],
    serif: bool = False,
    bold: bool = False,
    line_spacing: float = 1.22,
    shadow: bool = True,
) -> int:
    """Draw wrapped lines centered horizontally; return the next free y."""
    font = _load_font(fitted.font_size, serif=serif, bold=bold)
    line_height = round(fitted.font_size * line_spacing)
    y = top
    for line in fitted.lines:
        if shadow:
            draw.text((center_x + 2, y + 2), line, font=font, fill=(0, 0, 0, 170), anchor="ma")
        draw.text((center_x, y), line, font=font, fill=color, anchor="ma")
        y += line_height
    return y


def _cover_crop(cover_path: Path | None, width: int, height: int) -> Image.Image | None:
    """Scale the cover to fill ``width`` × ``height`` and crop the centre."""
    if cover_path is None or not cover_path.is_file():
        return None
    try:
        with Image.open(cover_path) as source:
            cover = source.convert("RGBA")
    except OSError:
        logger.warning("Could not read cover image %s", cover_path)
        return None

    scale = max(width / cover.width, height / cover.height)
    resized = cover.resize(
        (max(1, round(cover.width * scale)), max(1, round(cover.height * scale))),
        Image.LANCZOS,
    )
    left = (resized.width - width) // 2
    top = (resized.height - height) // 2
    return resized.crop((left, top, left + width, top + height))


def _cover_background(
    cover_path: Path | None,
    width: int,
    height: int,
    *,
    darken: int = 150,
    blur: bool = False,
) -> Image.Image:
    """Cover-crop the sermon image and darken it so text stays legible.

    ``blur`` is only used when the cover also appears sharp somewhere else on the
    card, so the background does not compete with it.
    """
    base = Image.new("RGBA", (width, height), _CARD_BG)
    cropped = _cover_crop(cover_path, width, height)
    if cropped is None:
        return base

    base.paste(cropped, (0, 0))
    if blur:
        base = base.filter(ImageFilter.GaussianBlur(radius=max(2, width // 60)))
    overlay = Image.new("RGBA", (width, height), (0, 0, 0, darken))
    return Image.alpha_composite(base, overlay)


def _qr_image(data: str, size: int) -> Image.Image | None:
    """Generate a QR locally (no network)."""
    try:
        import qrcode
    except ImportError:
        logger.warning("qrcode is not installed; skipping QR on the end card")
        return None
    try:
        code = qrcode.QRCode(box_size=10, border=2)
        code.add_data(data)
        code.make(fit=True)
        image = code.make_image(fill_color="black", back_color="white").convert("RGBA")
    except Exception:  # noqa: BLE001 — a bad URL must not break the render
        logger.warning("Could not build QR code for %r", data)
        return None
    return image.resize((size, size), Image.NEAREST)


def _paste_logo(
    canvas: Image.Image,
    logo_path: Path | None,
    *,
    box: int,
    center_x: int,
    y: int,
) -> int:
    if logo_path is None or not logo_path.is_file():
        return y
    try:
        with Image.open(logo_path) as source:
            logo = source.convert("RGBA")
    except OSError:
        logger.warning("Could not read logo %s", logo_path)
        return y
    scale = min(box / logo.width, box / logo.height)
    resized = logo.resize(
        (max(1, round(logo.width * scale)), max(1, round(logo.height * scale))),
        Image.LANCZOS,
    )
    canvas.alpha_composite(resized, (center_x - resized.width // 2, y))
    return y + resized.height


@dataclass(frozen=True)
class _TextBlock:
    """A fitted paragraph plus how it should be painted."""

    fitted: FittedText
    color: tuple[int, int, int, int]
    serif: bool = False
    bold: bool = False
    gap_after: int = 0

    @property
    def height(self) -> int:
        return round(self.fitted.font_size * 1.22) * len(self.fitted.lines)


def render_end_card(
    *,
    content: EndCardContent,
    layout: EndCardLayout | str,
    width: int,
    height: int,
) -> Image.Image:
    """Compose the end card image for the given canvas and layout.

    Vertical space is budgeted before anything is painted: the cover panel, the
    QR and the logo claim their bands first, and the text blocks are fitted into
    whatever is left. That is what keeps elements from overlapping.
    """
    layout_value = EndCardLayout(layout)
    area = safe_area(width, height)

    if layout_value == EndCardLayout.cover_full:
        canvas = _cover_background(content.cover_path, width, height, darken=140)
    elif layout_value == EndCardLayout.cover_card:
        # The cover also appears sharp inside the panel, so blur the backdrop.
        canvas = _cover_background(content.cover_path, width, height, darken=205, blur=True)
    else:
        canvas = Image.new("RGBA", (width, height), _CARD_BG)

    draw = ImageDraw.Draw(canvas)
    region_top = area.top

    if layout_value == EndCardLayout.cover_card:
        region_top = _draw_cover_card_panel(canvas, content, area, width)
    elif layout_value == EndCardLayout.minimal and content.logo_path is not None:
        region_top = _paste_logo(
            canvas,
            content.logo_path,
            box=round(height * 0.12),
            center_x=area.center_x,
            y=region_top,
        )
        region_top += round(height * 0.03)

    qr_size = round(min(width, height) * 0.15) if content.qr_url else 0
    logo_box = 0
    if layout_value in {EndCardLayout.cover_full, EndCardLayout.cover_card}:
        logo_box = round(height * 0.08) if content.logo_path is not None else 0
    reserved = qr_size + logo_box + (round(height * 0.025) if qr_size or logo_box else 0)
    available = max(round(height * 0.1), area.bottom - reserved - region_top)
    # The inter-paragraph gaps come out of the budget, so the fitted blocks plus
    # their gaps can never exceed the region.
    budget = max(1, available - round(height * _GAP_RATIO_TOTAL))

    serif = layout_value == EndCardLayout.minimal
    blocks = _text_blocks(content, area=area, height=height, available=budget, serif=serif)

    stack = sum(block.height for block in blocks)
    stack += sum(block.gap_after for block in blocks[:-1])
    # Centre the stack in its region; it anchors to the top when it barely fits.
    cursor = region_top + max(0, (available - stack) // 2)
    for index, block in enumerate(blocks):
        cursor = _draw_centered_block(
            draw,
            block.fitted,
            center_x=area.center_x,
            top=cursor,
            color=block.color,
            serif=block.serif,
            bold=block.bold,
        )
        if index < len(blocks) - 1:
            cursor += block.gap_after

    bottom = area.bottom
    if logo_box:
        _paste_logo(
            canvas,
            content.logo_path,
            box=logo_box,
            center_x=area.center_x,
            y=bottom - logo_box,
        )
        bottom -= logo_box + round(height * 0.015)

    if qr_size:
        qr = _qr_image(content.qr_url or "", qr_size)
        if qr is not None:
            canvas.alpha_composite(qr, (area.center_x - qr_size // 2, bottom - qr_size))

    return canvas


def _text_blocks(
    content: EndCardContent,
    *,
    area: SafeArea,
    height: int,
    available: int,
    serif: bool,
) -> list[_TextBlock]:
    """Fit every paragraph into its share of ``available`` vertical space."""
    blocks = [
        _TextBlock(
            fitted=fit_text(
                content.sermon_title,
                max_width=area.width,
                max_height=round(available * 0.5),
                max_lines=4,
                font_size=round(height * 0.052),
                measure=_measurer(serif=serif, bold=True),
                min_font_size=max(16, round(height * 0.018)),
            ),
            color=_TEXT_COLOR,
            serif=serif,
            bold=True,
            gap_after=round(height * _GAP_AFTER_TITLE),
        ),
        _TextBlock(
            fitted=fit_text(
                content.call_to_action,
                max_width=area.width,
                max_height=round(available * 0.24),
                max_lines=3,
                font_size=round(height * 0.030),
                measure=_measurer(),
                min_font_size=max(14, round(height * 0.014)),
            ),
            color=_MUTED_COLOR,
            gap_after=round(height * _GAP_AFTER_CTA),
        ),
    ]

    identity = " · ".join(part for part in (content.church_name, content.channel_handle) if part)
    if identity:
        blocks.append(
            _TextBlock(
                fitted=fit_text(
                    identity,
                    max_width=area.width,
                    max_height=round(available * 0.16),
                    max_lines=2,
                    font_size=round(height * 0.027),
                    measure=_measurer(bold=True),
                    min_font_size=max(12, round(height * 0.012)),
                ),
                color=_ACCENT_COLOR,
                bold=True,
                gap_after=round(height * _GAP_AFTER_IDENTITY),
            )
        )

    if content.url_text:
        blocks.append(
            _TextBlock(
                fitted=fit_text(
                    content.url_text,
                    max_width=area.width,
                    max_height=round(available * 0.1),
                    max_lines=2,
                    font_size=round(height * 0.021),
                    measure=_measurer(),
                    min_font_size=max(11, round(height * 0.01)),
                ),
                color=_MUTED_COLOR,
            )
        )

    return [block for block in blocks if block.fitted.lines]


def _draw_cover_card_panel(
    canvas: Image.Image,
    content: EndCardContent,
    area: SafeArea,
    width: int,
) -> int:
    """Draw the cover inside a rounded card and return the next free y."""
    panel_w = area.width
    panel_h = round(panel_w * 9 / 16)
    panel = Image.new("RGBA", (panel_w, panel_h), _CARD_PANEL)

    cropped = _cover_crop(content.cover_path, panel_w, panel_h)
    if cropped is not None:
        panel.paste(cropped, (0, 0))

    radius = max(8, round(width * 0.03))
    mask = Image.new("L", (panel_w, panel_h), 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, panel_w - 1, panel_h - 1), radius, fill=255)
    canvas.paste(panel, (area.left, area.top), mask)
    return area.top + panel_h + round(panel_h * 0.12)


def save_end_card(image: Image.Image, path: Path) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    image.convert("RGB").save(path, format="PNG")
    return path
