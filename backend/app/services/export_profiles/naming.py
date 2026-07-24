"""Safe output filenames for export profiles."""

from __future__ import annotations

import re
import unicodedata


def slugify(value: str, *, fallback: str = "clip", max_len: int = 48) -> str:
    """ASCII-fold into a filesystem-friendly token (lowercase, hyphens)."""
    folded = unicodedata.normalize("NFKD", (value or "").strip())
    ascii_only = folded.encode("ascii", "ignore").decode("ascii")
    keep = [char if char.isalnum() or char in {"-", "_"} else "-" for char in ascii_only]
    slug = "".join(keep).strip("-_").lower()
    while "--" in slug:
        slug = slug.replace("--", "-")
    slug = re.sub(r"[^a-z0-9_-]+", "", slug)
    return (slug[:max_len] or fallback).strip("-_")


def build_export_stem(
    *,
    project_title: str,
    clip_index: int,
    profile_slug: str,
) -> str:
    """Build ``titulo-sermon_clip-01_youtube-short`` (no extension)."""
    title = slugify(project_title, fallback="sermon")
    profile = slugify(profile_slug, fallback="export", max_len=32)
    index = max(1, min(clip_index, 999))
    return f"{title}_clip-{index:02d}_{profile}"
