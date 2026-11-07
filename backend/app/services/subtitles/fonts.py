"""Resolve installed fonts for libass. Never downloads fonts from the network."""

from __future__ import annotations

import logging
import os
import shutil
import sys
from dataclasses import dataclass
from functools import lru_cache
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
    "Times New Roman": (
        "/Library/Fonts/Times New Roman.ttf",
        "/System/Library/Fonts/Supplemental/Times New Roman.ttf",
        "/System/Library/Fonts/Times.ttc",
        r"C:\Windows\Fonts\times.ttf",
        "/usr/share/fonts/truetype/liberation/LiberationSerif-Regular.ttf",
    ),
    "Menlo": (
        "/System/Library/Fonts/Menlo.ttc",
        "/System/Library/Fonts/Monaco.ttf",
        r"C:\Windows\Fonts\consola.ttf",
        "/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf",
    ),
    "Avenir": (
        "/System/Library/Fonts/Avenir.ttc",
        "/System/Library/Fonts/Avenir Next.ttc",
        "/System/Library/Fonts/HelveticaNeue.ttc",
        r"C:\Windows\Fonts\calibri.ttf",
    ),
}

# Typical Word order: Office body fonts, then Windows core, then Mac classics.
_WORD_ORDER: tuple[str, ...] = (
    "Calibri",
    "Calibri Light",
    "Cambria",
    "Candara",
    "Consolas",
    "Constantia",
    "Corbel",
    "Arial",
    "Arial Black",
    "Arial Narrow",
    "Arial Rounded MT Bold",
    "Times New Roman",
    "Georgia",
    "Verdana",
    "Tahoma",
    "Trebuchet MS",
    "Comic Sans MS",
    "Impact",
    "Courier New",
    "Lucida Console",
    "Lucida Sans Unicode",
    "Lucida Grande",
    "Palatino Linotype",
    "Palatino",
    "Segoe UI",
    "Helvetica",
    "Helvetica Neue",
    "Avenir",
    "Avenir Next",
    "Futura",
    "Gill Sans",
    "Optima",
    "Baskerville",
    "Didot",
    "Hoefler Text",
    "American Typewriter",
    "Menlo",
    "Monaco",
    "Courier",
    "PT Sans",
    "PT Serif",
    "PT Mono",
)

_SKIP_FAMILY = (
    "apple color emoji",
    "noto color emoji",
    "lastresort",
    "last resort",
    ".sf ns",
    ".sf compact",
    "sfns",
)

_FONT_SUFFIXES = {".ttf", ".otf", ".ttc", ".TTF", ".OTF", ".TTC"}


@dataclass(frozen=True)
class FontFace:
    family: str
    path: Path
    index: int = 0
    bold: bool = False
    italic: bool = False


@dataclass(frozen=True)
class ResolvedFont:
    """Font family name for ASS + directory libass should scan."""

    family_name: str
    fonts_dir: Path
    source_path: Path


def _font_dirs() -> list[Path]:
    home = Path.home()
    dirs = [
        Path("/System/Library/Fonts"),
        Path("/System/Library/Fonts/Supplemental"),
        Path("/Library/Fonts"),
        home / "Library/Fonts",
        Path("/Library/Fonts/Microsoft"),
        home / "Library/Fonts/Microsoft",
        Path("/usr/share/fonts"),
        Path("/usr/local/share/fonts"),
        home / ".fonts",
        home / ".local/share/fonts",
    ]
    windir = os.environ.get("WINDIR") or r"C:\Windows"
    dirs.append(Path(windir) / "Fonts")
    local_app = os.environ.get("LOCALAPPDATA")
    if local_app:
        dirs.append(Path(local_app) / "Microsoft" / "FontCache")
    return [path for path in dirs if path.is_dir()]


def _skip_family(name: str) -> bool:
    lowered = name.strip().lower()
    if not lowered or lowered.startswith("."):
        return True
    return any(token in lowered for token in _SKIP_FAMILY)


def _u16(data: bytes, offset: int) -> int:
    return int.from_bytes(data[offset : offset + 2], "big")


def _u32(data: bytes, offset: int) -> int:
    return int.from_bytes(data[offset : offset + 4], "big")


def _decode_name(raw: bytes, platform: int, encoding: int) -> str:
    if platform == 3 or encoding in {1, 10}:
        return raw.decode("utf-16-be", errors="ignore").strip()
    if platform == 1:
        return raw.decode("mac_roman", errors="ignore").strip()
    return raw.decode("utf-8", errors="ignore").strip()


def _name_table(data: bytes, sfnt_offset: int) -> tuple[str, str] | None:
    if sfnt_offset + 12 > len(data):
        return None
    num_tables = _u16(data, sfnt_offset + 4)
    pos = sfnt_offset + 12
    name_off = name_len = None
    for _ in range(num_tables):
        if pos + 16 > len(data):
            break
        tag = data[pos : pos + 4]
        if tag == b"name":
            name_off = _u32(data, pos + 8)
            name_len = _u32(data, pos + 12)
            break
        pos += 16
    if name_off is None or name_len is None:
        return None
    table = data[name_off : name_off + name_len]
    if len(table) < 6:
        return None
    count = _u16(table, 2)
    storage = _u16(table, 4)
    names: dict[tuple[int, int], str] = {}
    rec = 6
    for _ in range(count):
        if rec + 12 > len(table):
            break
        platform = _u16(table, rec)
        encoding = _u16(table, rec + 2)
        language = _u16(table, rec + 4)
        name_id = _u16(table, rec + 6)
        length = _u16(table, rec + 8)
        offset = _u16(table, rec + 10)
        start = storage + offset
        raw = table[start : start + length]
        rec += 12
        if name_id not in {1, 2, 16, 17} or not raw:
            continue
        text = _decode_name(raw, platform, encoding)
        if not text:
            continue
        names[(name_id, language)] = text
        names.setdefault((name_id, -1), text)

    def pick(name_id: int) -> str:
        for language in (0x0409, 0, -1):
            value = names.get((name_id, language))
            if value:
                return value
        for (nid, _), value in names.items():
            if nid == name_id:
                return value
        return ""

    family = pick(16) or pick(1)
    subfamily = pick(17) or pick(2) or "Regular"
    if not family:
        return None
    return family, subfamily


def _sfnt_offsets(data: bytes) -> list[int]:
    if data[:4] == b"ttcf":
        if len(data) < 12:
            return []
        count = _u32(data, 8)
        offsets = []
        pos = 12
        for _ in range(count):
            if pos + 4 > len(data):
                break
            offsets.append(_u32(data, pos))
            pos += 4
        return offsets
    return [0]


def _faces_from_file(path: Path) -> list[FontFace]:
    try:
        data = path.read_bytes()
    except OSError:
        return []
    faces: list[FontFace] = []
    for index, offset in enumerate(_sfnt_offsets(data)):
        parsed = _name_table(data, offset)
        if parsed is None:
            continue
        family, subfamily = parsed
        if _skip_family(family):
            continue
        lowered = subfamily.lower()
        faces.append(
            FontFace(
                family=family,
                path=path,
                index=index,
                bold="bold" in lowered or "black" in lowered or "heavy" in lowered,
                italic="italic" in lowered or "oblique" in lowered,
            )
        )
    if faces:
        return faces
    stem = path.stem.replace("-", " ").replace("_", " ").strip()
    if stem and not _skip_family(stem):
        return [FontFace(family=stem, path=path)]
    return []


def _iter_font_files() -> list[Path]:
    found: list[Path] = []
    seen: set[str] = set()
    for directory in _font_dirs():
        try:
            for path in directory.rglob("*"):
                if path.suffix not in _FONT_SUFFIXES or not path.is_file():
                    continue
                key = str(path)
                if key in seen:
                    continue
                seen.add(key)
                found.append(path)
        except OSError:
            continue
    for paths in _FONT_CANDIDATES.values():
        for path_str in paths:
            if sys.platform.startswith("win"):
                if path_str.startswith("/") and not path_str.startswith("//"):
                    continue
            elif path_str.startswith("C:\\") or path_str.startswith("c:\\"):
                continue
            path = Path(path_str)
            key = str(path)
            if key in seen or not path.is_file():
                continue
            seen.add(key)
            found.append(path)
    return found


@lru_cache(maxsize=1)
def _catalog() -> dict[str, list[FontFace]]:
    grouped: dict[str, list[FontFace]] = {}
    for path in _iter_font_files():
        for face in _faces_from_file(path):
            grouped.setdefault(face.family, []).append(face)
    return grouped


def list_available_fonts() -> list[str]:
    """Return family names installed on this machine, Word-like order first."""
    families = [name for name in _catalog() if not _skip_family(name)]
    if not families:
        return ["Helvetica Neue"]
    rank = {name: index for index, name in enumerate(_WORD_ORDER)}
    families.sort(key=lambda name: (rank.get(name, 10_000), name.lower()))
    return families


def pick_face(family: str, *, bold: bool = False, italic: bool = False) -> FontFace | None:
    faces = _catalog().get(family) or []
    if not faces:
        return None

    def score(face: FontFace) -> tuple[int, int, int]:
        return (
            0 if face.bold == bold else 1,
            0 if face.italic == italic else 1,
            face.index,
        )

    return sorted(faces, key=score)[0]


def resolve_font(family: str, fonts_dir: Path) -> ResolvedFont:
    """Locate an installed font and stage it into ``fonts_dir`` for FFmpeg.

    Staging a copy (or hardlink) keeps libass from depending on Fontconfig
    discovering the whole system catalogue, and guarantees the face we named
    in the ASS header is available.
    """
    fonts_dir.mkdir(parents=True, exist_ok=True)
    face = pick_face(family)
    candidates: list[str] = []
    if face is not None:
        candidates.append(str(face.path))
    candidates.extend(_FONT_CANDIDATES.get(family, ()))
    candidates.extend(_FONT_CANDIDATES["Helvetica Neue"])
    seen: set[str] = set()
    for path_str in candidates:
        if path_str in seen:
            continue
        seen.add(path_str)
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
        resolved_family = family if family in _catalog() or family in _FONT_CANDIDATES else "Helvetica Neue"
        return ResolvedFont(
            family_name=resolved_family,
            fonts_dir=fonts_dir,
            source_path=source,
        )

    logger.warning("No preferred system font found for %r; relying on libass defaults", family)
    return ResolvedFont(family_name=family, fonts_dir=fonts_dir, source_path=Path())
