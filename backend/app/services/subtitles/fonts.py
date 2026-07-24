"""Resolve installed fonts for libass. Never downloads fonts from the network."""

from __future__ import annotations

import logging
import shutil
import sys
from dataclasses import dataclass
from pathlib import Path

logger = logging.getLogger(__name__)

# System font candidates only (macOS / Windows / Linux). Never bundle proprietary
# faces into the app installer — staging a local copy for libass is fine.
_FONT_CANDIDATES: dict[str, tuple[str, ...]] = {
    "Helvetica Neue": (
        "/System/Library/Fonts/HelveticaNeue.ttc",
        "/System/Library/Fonts/Helvetica.ttc",
        "/Library/Fonts/Arial.ttf",
        "/System/Library/Fonts/Supplemental/Arial.ttf",
        r"C:\Windows\Fonts\arial.ttf",
        r"C:\Windows\Fonts\segoeui.ttf",
        "/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf",
        "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
        "/usr/share/fonts/TTF/DejaVuSans.ttf",
        "/usr/share/fonts/truetype/freefont/FreeSans.ttf",
    ),
    "Helvetica": (
        "/System/Library/Fonts/Helvetica.ttc",
        "/System/Library/Fonts/HelveticaNeue.ttc",
        "/Library/Fonts/Arial.ttf",
        r"C:\Windows\Fonts\arial.ttf",
        "/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf",
        "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
    ),
    "Arial": (
        "/Library/Fonts/Arial.ttf",
        "/System/Library/Fonts/Supplemental/Arial.ttf",
        "/System/Library/Fonts/Helvetica.ttc",
        r"C:\Windows\Fonts\arial.ttf",
        r"C:\Windows\Fonts\arialbd.ttf",
        "/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf",
        "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
    ),
    "Georgia": (
        "/Library/Fonts/Georgia.ttf",
        "/System/Library/Fonts/Supplemental/Georgia.ttf",
        "/System/Library/Fonts/NewYork.ttf",
        "/System/Library/Fonts/HelveticaNeue.ttc",
        r"C:\Windows\Fonts\georgia.ttf",
        "/usr/share/fonts/truetype/liberation/LiberationSerif-Regular.ttf",
        "/usr/share/fonts/truetype/dejavu/DejaVuSerif.ttf",
        "/usr/share/fonts/TTF/DejaVuSerif.ttf",
    ),
}


@dataclass(frozen=True)
class ResolvedFont:
    """Font family name for ASS + directory libass should scan."""

    family_name: str
    fonts_dir: Path
    source_path: Path


def resolve_font(family: str, fonts_dir: Path) -> ResolvedFont:
    """Locate an installed font and stage it into ``fonts_dir`` for FFmpeg.

    Staging a copy (or hardlink) keeps libass from depending on Fontconfig
    discovering the whole system catalogue, and guarantees the face we named
    in the ASS header is available.
    """
    fonts_dir.mkdir(parents=True, exist_ok=True)
    candidates = _FONT_CANDIDATES.get(family, ())
    # Always fall back through Helvetica Neue → Helvetica → Arial.
    search = list(candidates) + list(_FONT_CANDIDATES["Helvetica Neue"])
    seen: set[str] = set()
    for path_str in search:
        if path_str in seen:
            continue
        seen.add(path_str)
        # Skip clearly foreign OS paths to avoid pointless stat() noise.
        if sys.platform.startswith("win"):
            if path_str.startswith("/") and not path_str.startswith("//"):
                continue
        elif path_str.startswith("C:\\") or path_str.startswith("c:\\"):
            continue
        source = Path(path_str)
        if not source.is_file():
            continue
        destination = fonts_dir / source.name
        if not destination.exists():
            try:
                shutil.copy2(source, destination)
            except OSError:
                try:
                    if not destination.exists():
                        destination.symlink_to(source)
                except OSError as exc:
                    logger.warning("Could not stage font %s: %s", source, exc)
                    continue
        # Map back to a family ASS understands.
        resolved_family = family if family in _FONT_CANDIDATES else "Helvetica Neue"
        name_lower = source.name.lower()
        if (
            "georgia" in name_lower
            or "liberationserif" in name_lower
            or "dejavuserif" in name_lower
        ):
            resolved_family = "Georgia" if family == "Georgia" else resolved_family
        elif (
            "arial" in name_lower
            or "liberation" in name_lower
            or "dejavusans" in name_lower
        ):
            sans_families = {"Arial", "Helvetica", "Helvetica Neue"}
            resolved_family = "Arial" if family in sans_families else family
        elif "helveticaneue" in name_lower or "helvetica" in name_lower:
            resolved_family = "Helvetica Neue" if family == "Helvetica Neue" else "Helvetica"
        return ResolvedFont(
            family_name=resolved_family,
            fonts_dir=fonts_dir,
            source_path=source,
        )

    # Last resort: empty fontsdir; libass may still find a default.
    logger.warning("No preferred system font found for %r; relying on libass defaults", family)
    return ResolvedFont(family_name=family, fonts_dir=fonts_dir, source_path=Path())
