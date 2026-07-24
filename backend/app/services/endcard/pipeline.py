"""Materialize the end card for a render: PNG on disk plus the FFmpeg spec."""

from __future__ import annotations

from pathlib import Path

from app.models.end_card import (
    MAX_END_CARD_SECONDS,
    MIN_END_CARD_SECONDS,
    EndCardAudioMode,
)
from app.models.project import Project
from app.services import storage
from app.services.endcard.image import render_end_card, save_end_card
from app.services.endcard.layout import clamp_duration
from app.services.endcard.service import ResolvedEndCard, build_content
from app.services.render.args import EndCardSpec


def build_end_card_spec(
    *,
    project: Project,
    config: ResolvedEndCard,
    width: int,
    height: int,
    image_path: Path,
    main_content_end_seconds: float | None = None,
    source_duration_seconds: float | None = None,
) -> EndCardSpec:
    """Render the card image and return the spec FFmpeg needs to append it.

    ``main_content_end_seconds`` is the source position right after the last
    segment, used when the audio should keep playing over the card. It is
    dropped (falling back to silence) when the source has nothing left to play.
    """
    content = build_content(project, config)
    duration = clamp_duration(
        config.duration_seconds, minimum=MIN_END_CARD_SECONDS, maximum=MAX_END_CARD_SECONDS
    )

    image = render_end_card(content=content, layout=config.layout, width=width, height=height)
    save_end_card(image, image_path)

    music_path: Path | None = None
    if config.audio_mode == EndCardAudioMode.local_music and config.music_filename:
        candidate = storage.resolve_inside_project(project.id, config.music_filename)
        music_path = candidate if candidate.is_file() else None

    continue_from: float | None = None
    if config.audio_mode == EndCardAudioMode.continue_with_fade:
        tail_start = main_content_end_seconds
        if tail_start is not None and (
            source_duration_seconds is None or tail_start < source_duration_seconds - 0.1
        ):
            continue_from = tail_start

    return EndCardSpec(
        image_path=image_path,
        duration=duration,
        fade_in_seconds=config.fade_in_ms / 1000.0,
        audio_fade_out_seconds=config.audio_fade_out_ms / 1000.0,
        audio_mode=config.audio_mode.value,
        music_path=music_path,
        music_volume=config.music_volume,
        continue_from_seconds=continue_from,
    )
