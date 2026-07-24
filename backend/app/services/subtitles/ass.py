"""Generate Advanced SubStation Alpha (ASS) documents for libass burning."""

from __future__ import annotations

from pathlib import Path

from app.services.subtitles.cues import SubtitleCue
from app.services.subtitles.fonts import ResolvedFont
from app.services.subtitles.templates import (
    StyleTemplate,
    SubtitleOptions,
    ass_alignment_for,
    get_template,
)


def ass_timestamp(seconds: float) -> str:
    """Format seconds as ASS ``H:MM:SS.cs`` (centiseconds)."""
    if seconds < 0:
        seconds = 0.0
    total_cs = int(round(seconds * 100))
    hours, rem = divmod(total_cs, 3600 * 100)
    minutes, rem = divmod(rem, 60 * 100)
    secs, cs = divmod(rem, 100)
    return f"{hours}:{minutes:02d}:{secs:02d}.{cs:02d}"


def _alpha_prefix(opacity: float) -> str:
    """ASS primary alpha override: 00 opaque … FF invisible."""
    alpha = int(round((1.0 - max(0.0, min(1.0, opacity))) * 255))
    return f"{alpha:02X}"


def escape_ass_text(text: str) -> str:
    """Escape ASS special characters while preserving intentional ``\\N`` breaks."""
    # Protect intentional line breaks, escape braces, restore breaks.
    placeholder = "\u0000"
    protected = text.replace("\\N", placeholder)
    protected = protected.replace("{", "\\{").replace("}", "\\}")
    return protected.replace(placeholder, "\\N")


def build_style_line(
    template: StyleTemplate,
    options: SubtitleOptions,
    font: ResolvedFont,
    *,
    play_res_x: int,
    play_res_y: int,
) -> str:
    """Build one ``Style:`` row for the ASS Styles section."""
    del play_res_x  # reserved for future scaling heuristics
    alignment = ass_alignment_for(options.position)
    # Safe margins: keep captions away from edges (requirement).
    margin_l = max(48, play_res_y // 24)
    margin_r = margin_l
    margin_v = max(48, options.margin_bottom)
    if options.position.value == "top":
        margin_v = max(48, options.margin_bottom // 2 + 40)

    primary = _apply_opacity(template.primary_color, options.opacity)
    secondary = _apply_opacity(template.secondary_color, options.opacity)
    outline = template.outline_color
    back = template.back_color

    return (
        f"Style: Default,{font.family_name},{options.font_size},"
        f"{primary},{secondary},{outline},{back},"
        f"{-1 if template.bold else 0},{-1 if template.italic else 0},0,0,"
        f"100,100,0,0,"
        f"{template.border_style},{template.outline},{template.shadow},"
        f"{alignment},{margin_l},{margin_r},{margin_v},1"
    )


def _apply_opacity(ass_color: str, opacity: float) -> str:
    """Replace the AA byte of ``&HAABBGGRR`` according to opacity."""
    if not ass_color.startswith("&H") or len(ass_color) < 10:
        return ass_color
    return f"&H{_alpha_prefix(opacity)}{ass_color[4:]}"


def format_dialogue_text(
    cue: SubtitleCue, template: StyleTemplate, options: SubtitleOptions
) -> str:
    """Render cue text, including word-highlight karaoke for modern styles."""
    if cue.highlight and cue.words and template.highlight_current_word:
        return _karaoke_highlight(cue, template, options)
    return escape_ass_text(cue.text)


def _karaoke_highlight(
    cue: SubtitleCue,
    template: StyleTemplate,
    options: SubtitleOptions,
) -> str:
    """Emit one Dialogue with ``\\k`` tags so the current word lights up.

    SecondaryColour holds the highlight; PrimaryColour is the resting colour.
    Pauses between words (and lead-in before the first word) are encoded as
    empty ``\\k`` holds so the highlight stays aligned with speech.
    """
    parts: list[str] = []
    cursor = cue.start
    for index, word in enumerate(cue.words):
        gap = word.start - cursor
        if gap > 0.005:
            gap_cs = max(1, int(round(gap * 100)))
            parts.append(f"{{\\k{gap_cs}}}")
        # \\k duration is centiseconds of this word's hold.
        hold_cs = max(1, int(round((word.end - word.start) * 100)))
        token = _case(word.text, options.uppercase)
        parts.append(f"{{\\k{hold_cs}}}{escape_ass_text(token)}")
        if index + 1 < len(cue.words):
            parts.append(r"{\k0} ")
        cursor = max(cursor, word.end)
    prefix = r"{\fad(80,80)}" if template.animate else ""
    return prefix + "".join(parts)


def _case(text: str, uppercase: bool) -> str:
    return text.upper() if uppercase else text


def render_ass_document(
    *,
    cues: list[SubtitleCue],
    options: SubtitleOptions,
    font: ResolvedFont,
    play_res_x: int,
    play_res_y: int,
) -> str:
    """Return a complete ASS file as text."""
    template = get_template(options.style)
    style_line = build_style_line(
        template, options, font, play_res_x=play_res_x, play_res_y=play_res_y
    )
    events = [
        "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text"
    ]
    for cue in cues:
        if cue.end <= cue.start:
            continue
        text = format_dialogue_text(cue, template, options)
        if not text.strip():
            continue
        events.append(
            "Dialogue: 0,"
            f"{ass_timestamp(cue.start)},{ass_timestamp(cue.end)},"
            f"Default,,0,0,0,,"
            f"{text}"
        )

    header = [
        "[Script Info]",
        "ScriptType: v4.00+",
        "WrapStyle: 0",
        "ScaledBorderAndShadow: yes",
        "YCbCr Matrix: TV.709",
        f"PlayResX: {play_res_x}",
        f"PlayResY: {play_res_y}",
        "",
        "[V4+ Styles]",
        "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, "
        "OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, "
        "ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, "
        "Alignment, MarginL, MarginR, MarginV, Encoding",
        style_line,
        "",
        "[Events]",
        *events,
        "",
    ]
    return "\n".join(header)


def write_ass_file(path: Path, document: str) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(document, encoding="utf-8")
    return path
