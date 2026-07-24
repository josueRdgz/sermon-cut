"""Optional local background music for Reels."""

from app.services.background_music.ffmpeg_filters import (
    BackgroundMusicSpec,
    build_background_music_graph,
    build_loudnorm_filter,
)
from app.services.background_music.service import (
    attach_music,
    build_meters,
    list_presets,
    resolve_spec,
    to_response,
    update_settings,
)

__all__ = [
    "BackgroundMusicSpec",
    "attach_music",
    "build_background_music_graph",
    "build_loudnorm_filter",
    "build_meters",
    "list_presets",
    "resolve_spec",
    "to_response",
    "update_settings",
]
