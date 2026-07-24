"""Builtin export profile definitions (editable after seed)."""

from __future__ import annotations

from typing import Any

from app.models.export_profile import ExportPlatform, FpsMode

# Filename token after ``clip-NN_`` — keep short and filesystem-safe.
BUILTIN_PROFILES: tuple[dict[str, Any], ...] = (
    {
        "slug": "youtube-short",
        "name": "YouTube Shorts",
        "description": (
            "1080×1920 · 9:16 · H.264 + AAC. Duración máxima 60 s "
            "(configurable hasta 180). FPS del original o 30."
        ),
        "platform": ExportPlatform.youtube_shorts,
        "width": 1080,
        "height": 1920,
        "aspect_ratio": "9:16",
        "max_duration_seconds": 60,
        "fps_mode": FpsMode.original,
        "safe_margin_x": 0.08,
        "safe_top": 0.10,
        "safe_bottom": 0.16,
        "crf_draft": 28,
        "crf_standard": 23,
        "crf_high": 18,
        "prefer_small_file": False,
        "fragmentation_enabled": False,
        "fragment_max_seconds": None,
    },
    {
        "slug": "facebook-reel",
        "name": "Facebook Reels",
        "description": "1080×1920 · H.264 + AAC con área segura para la UI de Facebook.",
        "platform": ExportPlatform.facebook_reels,
        "width": 1080,
        "height": 1920,
        "aspect_ratio": "9:16",
        "max_duration_seconds": 90,
        "fps_mode": FpsMode.original,
        "safe_margin_x": 0.08,
        "safe_top": 0.12,
        "safe_bottom": 0.18,
        "crf_draft": 28,
        "crf_standard": 23,
        "crf_high": 18,
        "prefer_small_file": False,
        "fragmentation_enabled": False,
        "fragment_max_seconds": None,
    },
    {
        "slug": "instagram-reel",
        "name": "Instagram Reels",
        "description": (
            "1080×1920 · H.264 + AAC. Área segura superior e inferior "
            "ampliada para la UI de Instagram."
        ),
        "platform": ExportPlatform.instagram_reels,
        "width": 1080,
        "height": 1920,
        "aspect_ratio": "9:16",
        "max_duration_seconds": 90,
        "fps_mode": FpsMode.original,
        "safe_margin_x": 0.08,
        "safe_top": 0.14,
        "safe_bottom": 0.20,
        "crf_draft": 28,
        "crf_standard": 23,
        "crf_high": 18,
        "prefer_small_file": False,
        "fragmentation_enabled": False,
        "fragment_max_seconds": None,
    },
    {
        "slug": "whatsapp-status",
        "name": "WhatsApp Status",
        "description": (
            "1080×1920 · H.264 + AAC con tamaño de archivo reducido. "
            "Fragmentación opcional para estados largos."
        ),
        "platform": ExportPlatform.whatsapp_status,
        "width": 1080,
        "height": 1920,
        "aspect_ratio": "9:16",
        "max_duration_seconds": 30,
        "fps_mode": FpsMode.fixed_30,
        "safe_margin_x": 0.06,
        "safe_top": 0.08,
        "safe_bottom": 0.12,
        "crf_draft": 30,
        "crf_standard": 26,
        "crf_high": 23,
        "preset_draft": "veryfast",
        "preset_standard": "fast",
        "preset_high": "medium",
        "audio_bitrate_draft_k": 96,
        "audio_bitrate_standard_k": 112,
        "audio_bitrate_high_k": 128,
        "prefer_small_file": True,
        "fragmentation_enabled": False,
        "fragment_max_seconds": 30,
    },
)
