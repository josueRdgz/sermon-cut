"""Mandatory end card: settings, Pillow rendering and FFmpeg concatenation."""

from app.services.endcard.service import (
    ResolvedEndCard,
    build_content,
    resolve,
    resolve_global,
)

__all__ = ["ResolvedEndCard", "build_content", "resolve", "resolve_global"]
