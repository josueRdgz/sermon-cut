"""Subtitle style options and ASS template presets."""

from __future__ import annotations

import enum
from dataclasses import dataclass, replace


class SubtitleGranularity(enum.StrEnum):
    """How finely cues are split."""

    auto = "auto"
    segment = "segment"
    phrase = "phrase"
    word = "word"


class SubtitlePosition(enum.StrEnum):
    bottom = "bottom"
    center = "center"
    top = "top"


@dataclass(frozen=True)
class SubtitleOptions:
    """User-facing customization that layers on top of a style template."""

    style: str = "reformed_sober"
    enabled: bool = True
    granularity: SubtitleGranularity = SubtitleGranularity.auto
    font_size: int = 52
    position: SubtitlePosition = SubtitlePosition.bottom
    uppercase: bool = False
    max_words: int = 6
    opacity: float = 1.0
    margin_bottom: int = 120
    bible_reference: str | None = None

    def with_overrides(self, **kwargs: object) -> SubtitleOptions:
        return replace(self, **kwargs)


@dataclass(frozen=True)
class StyleTemplate:
    """Visual defaults for one ASS style preset."""

    id: str
    label: str
    description: str
    # Preferred ASS Fontname (must resolve via fonts.py / system fonts).
    font_name: str
    primary_color: str  # ASS &HAABBGGRR
    secondary_color: str
    outline_color: str
    back_color: str
    bold: bool
    italic: bool
    outline: float
    shadow: float
    border_style: int  # 1 = outline+shadow, 3 = opaque box
    alignment: int  # numpad (2 = bottom-center)
    max_lines: int
    max_chars_per_line: int
    default_granularity: SubtitleGranularity
    animate: bool
    highlight_current_word: bool
    quote_style: bool
    default_font_size: int
    default_max_words: int
    default_uppercase: bool
    default_margin_bottom: int


# ASS colour is &HAABBGGRR (alpha, blue, green, red). Alpha 00 = opaque.
TEMPLATES: dict[str, StyleTemplate] = {
    "reformed_sober": StyleTemplate(
        id="reformed_sober",
        label="Reformed sober",
        description="Texto blanco, contorno oscuro, tipografía seria, máx. 2 líneas.",
        font_name="Helvetica Neue",
        primary_color="&H00FFFFFF",
        secondary_color="&H00FFFFFF",
        outline_color="&H00101010",
        back_color="&H80000000",
        bold=False,
        italic=False,
        outline=2.4,
        shadow=0.0,
        border_style=1,
        alignment=2,
        max_lines=2,
        max_chars_per_line=32,
        default_granularity=SubtitleGranularity.phrase,
        animate=False,
        highlight_current_word=False,
        quote_style=False,
        default_font_size=48,
        default_max_words=12,
        default_uppercase=False,
        default_margin_bottom=140,
    ),
    "modern_highlight": StyleTemplate(
        id="modern_highlight",
        label="Modern highlight",
        description="Grupos cortos con la palabra actual resaltada.",
        font_name="Helvetica Neue",
        primary_color="&H00FFFFFF",
        secondary_color="&H0000D7FF",  # amber-ish highlight in BGR
        outline_color="&H00202020",
        back_color="&H64000000",
        bold=True,
        italic=False,
        outline=2.8,
        shadow=0.0,
        border_style=1,
        alignment=2,
        max_lines=1,
        max_chars_per_line=28,
        default_granularity=SubtitleGranularity.word,
        animate=True,
        highlight_current_word=True,
        quote_style=False,
        default_font_size=56,
        default_max_words=5,
        default_uppercase=True,
        default_margin_bottom=160,
    ),
    "clear_reading": StyleTemplate(
        id="clear_reading",
        label="Clear reading",
        description="Dos líneas sobre caja semitransparente, sin animación.",
        font_name="Helvetica Neue",
        primary_color="&H00FFFFFF",
        secondary_color="&H00FFFFFF",
        outline_color="&H00000000",
        back_color="&H90202020",
        bold=False,
        italic=False,
        outline=0.0,
        shadow=0.0,
        border_style=3,  # opaque box
        alignment=2,
        max_lines=2,
        max_chars_per_line=36,
        default_granularity=SubtitleGranularity.phrase,
        animate=False,
        highlight_current_word=False,
        quote_style=False,
        default_font_size=50,
        default_max_words=14,
        default_uppercase=False,
        default_margin_bottom=120,
    ),
    "sermon_quote": StyleTemplate(
        id="sermon_quote",
        label="Sermon quote",
        description="Cita completa; referencia bíblica opcional.",
        font_name="Georgia",
        primary_color="&H00F5F5F5",
        secondary_color="&H00F5F5F5",
        outline_color="&H00282828",
        back_color="&HA01A1A1A",
        bold=False,
        italic=True,
        outline=1.6,
        shadow=0.0,
        border_style=3,
        alignment=2,
        max_lines=3,
        max_chars_per_line=34,
        default_granularity=SubtitleGranularity.segment,
        animate=False,
        highlight_current_word=False,
        quote_style=True,
        default_font_size=46,
        default_max_words=24,
        default_uppercase=False,
        default_margin_bottom=180,
    ),
}

# Legacy values persisted before the template rename.
STYLE_ALIASES: dict[str, str] = {
    "default": "reformed_sober",
    "bold": "modern_highlight",
    "caption": "clear_reading",
}


def resolve_style_id(style: str) -> str:
    normalized = STYLE_ALIASES.get(style, style)
    if normalized not in TEMPLATES:
        return "reformed_sober"
    return normalized


def get_template(style: str) -> StyleTemplate:
    return TEMPLATES[resolve_style_id(style)]


def options_from_reel(
    *,
    style: str,
    enabled: bool = True,
    granularity: str | None = None,
    font_size: int | None = None,
    position: str | None = None,
    uppercase: bool | None = None,
    max_words: int | None = None,
    opacity: float | None = None,
    margin_bottom: int | None = None,
    bible_reference: str | None = None,
) -> SubtitleOptions:
    template = get_template(style)
    gran = SubtitleGranularity(granularity) if granularity else template.default_granularity
    return SubtitleOptions(
        style=template.id,
        enabled=enabled,
        granularity=gran,
        font_size=font_size if font_size is not None else template.default_font_size,
        position=SubtitlePosition(position) if position else SubtitlePosition.bottom,
        uppercase=uppercase if uppercase is not None else template.default_uppercase,
        max_words=max_words if max_words is not None else template.default_max_words,
        opacity=1.0 if opacity is None else max(0.0, min(1.0, opacity)),
        margin_bottom=(
            margin_bottom if margin_bottom is not None else template.default_margin_bottom
        ),
        bible_reference=bible_reference,
    )


def ass_alignment_for(position: SubtitlePosition) -> int:
    if position == SubtitlePosition.top:
        return 8
    if position == SubtitlePosition.center:
        return 5
    return 2
