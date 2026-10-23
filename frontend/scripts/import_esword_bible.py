#!/usr/bin/env python3
"""Importa un módulo e-Sword (.bbli) a JSON local para el lector de Biblia.

El texto convertido queda en frontend/public/bible/ y no debe subirse al repo.
"""

from __future__ import annotations

import argparse
import json
import re
import sqlite3
import sys
from html import unescape
from html.parser import HTMLParser
from pathlib import Path

BOOKS: list[tuple[int, str, str]] = [
    (1, "GEN", "Génesis"),
    (2, "EXO", "Éxodo"),
    (3, "LEV", "Levítico"),
    (4, "NUM", "Números"),
    (5, "DEU", "Deuteronomio"),
    (6, "JOS", "Josué"),
    (7, "JDG", "Jueces"),
    (8, "RUT", "Rut"),
    (9, "1SA", "1 Samuel"),
    (10, "2SA", "2 Samuel"),
    (11, "1KI", "1 Reyes"),
    (12, "2KI", "2 Reyes"),
    (13, "1CH", "1 Crónicas"),
    (14, "2CH", "2 Crónicas"),
    (15, "EZR", "Esdras"),
    (16, "NEH", "Nehemías"),
    (17, "EST", "Ester"),
    (18, "JOB", "Job"),
    (19, "PSA", "Salmos"),
    (20, "PRO", "Proverbios"),
    (21, "ECC", "Eclesiastés"),
    (22, "SNG", "Cantares"),
    (23, "ISA", "Isaías"),
    (24, "JER", "Jeremías"),
    (25, "LAM", "Lamentaciones"),
    (26, "EZK", "Ezequiel"),
    (27, "DAN", "Daniel"),
    (28, "HOS", "Oseas"),
    (29, "JOL", "Joel"),
    (30, "AMO", "Amós"),
    (31, "OBA", "Abdías"),
    (32, "JON", "Jonás"),
    (33, "MIC", "Miqueas"),
    (34, "NAM", "Nahúm"),
    (35, "HAB", "Habacuc"),
    (36, "ZEP", "Sofonías"),
    (37, "HAG", "Hageo"),
    (38, "ZEC", "Zacarías"),
    (39, "MAL", "Malaquías"),
    (40, "MAT", "Mateo"),
    (41, "MRK", "Marcos"),
    (42, "LUK", "Lucas"),
    (43, "JHN", "Juan"),
    (44, "ACT", "Hechos"),
    (45, "ROM", "Romanos"),
    (46, "1CO", "1 Corintios"),
    (47, "2CO", "2 Corintios"),
    (48, "GAL", "Gálatas"),
    (49, "EPH", "Efesios"),
    (50, "PHP", "Filipenses"),
    (51, "COL", "Colosenses"),
    (52, "1TH", "1 Tesalonicenses"),
    (53, "2TH", "2 Tesalonicenses"),
    (54, "1TI", "1 Timoteo"),
    (55, "2TI", "2 Timoteo"),
    (56, "TIT", "Tito"),
    (57, "PHM", "Filemón"),
    (58, "HEB", "Hebreos"),
    (59, "JAS", "Santiago"),
    (60, "1PE", "1 Pedro"),
    (61, "2PE", "2 Pedro"),
    (62, "1JN", "1 Juan"),
    (63, "2JN", "2 Juan"),
    (64, "3JN", "3 Juan"),
    (65, "JUD", "Judas"),
    (66, "REV", "Apocalipsis"),
]


class ScriptureParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self._skip = 0
        self._skip_heading = 0
        self.parts: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        style = ""
        for key, value in attrs:
            if key.lower() == "style" and value:
                style = value.replace(" ", "").lower()
        if tag == "sup":
            self._skip += 1
        if tag == "p" and "text-align:center" in style:
            self._skip_heading += 1

    def handle_endtag(self, tag: str) -> None:
        if tag == "sup" and self._skip:
            self._skip -= 1
        if tag == "p" and self._skip_heading:
            self._skip_heading -= 1

    def handle_data(self, data: str) -> None:
        if self._skip or self._skip_heading:
            return
        self.parts.append(data)


def scripture_to_text(raw: str) -> str:
    parser = ScriptureParser()
    parser.feed(raw or "")
    text = unescape("".join(parser.parts))
    return re.sub(r"\s+", " ", text).strip()


def import_module(source: Path, dest: Path) -> None:
    if not source.is_file():
        raise FileNotFoundError(f"No se encontró {source}")
    dest.mkdir(parents=True, exist_ok=True)
    con = sqlite3.connect(f"file:{source}?mode=ro", uri=True)
    try:
        rows = con.execute("SELECT Book, Chapter, Verse, Scripture FROM Bible ORDER BY Book, Chapter, Verse")
        by_book: dict[int, dict[int, dict[int, str]]] = {}
        verse_count = 0
        for book_num, chapter, verse, scripture in rows:
            text = scripture_to_text(scripture)
            if not text:
                continue
            by_book.setdefault(int(book_num), {}).setdefault(int(chapter), {})[int(verse)] = text
            verse_count += 1
    finally:
        con.close()

    index: list[dict[str, object]] = []
    for book_num, book_id, name in BOOKS:
        chapters_map = by_book.get(book_num, {})
        if not chapters_map:
            continue
        max_chapter = max(chapters_map)
        chapters: list[list[str]] = []
        for chapter in range(1, max_chapter + 1):
            verses_map = chapters_map.get(chapter, {})
            max_verse = max(verses_map) if verses_map else 0
            chapters.append([verses_map.get(verse, "") for verse in range(1, max_verse + 1)])
        payload = {"id": book_id, "name": name, "chapters": chapters}
        (dest / f"{book_id}.json").write_text(
            json.dumps(payload, ensure_ascii=False, separators=(",", ":")),
            encoding="utf-8",
        )
        index.append({"id": book_id, "name": name, "chapters": len(chapters)})

    (dest / "index.json").write_text(
        json.dumps(index, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    print(f"Importados {len(index)} libros y {verse_count} versículos en {dest}")


def main() -> int:
    root = Path(__file__).resolve().parents[1]
    parser = argparse.ArgumentParser(description="Importa un .bbli de e-Sword a JSON local.")
    parser.add_argument("source", type=Path, help="Ruta al archivo .bbli")
    parser.add_argument(
        "--out",
        type=Path,
        default=root / "public" / "bible" / "rv1960",
        help="Carpeta de salida",
    )
    args = parser.parse_args()
    import_module(args.source.expanduser(), args.out)
    return 0


if __name__ == "__main__":
    sys.exit(main())
