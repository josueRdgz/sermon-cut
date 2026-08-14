"""Materialize the end card for a render: PNG on disk plus the FFmpeg spec."""

from __future__ import annotations

from pathlib import Path

from app.models.end_card import (
    MAX_END_CARD_SECONDS,
    MIN_END_CARD_SECONDS,
    EndCardAudioMode,
)
from app.models.project import Project
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

    image = render_end_card(
        content=content,
        layout=config.layout,
        width=width,
        height=height,
        message_position=config.message_position,
    )
    save_end_card(image, image_path)

    return EndCardSpec(
        image_path=image_path,
        duration=duration,
        fade_in_seconds=config.fade_in_ms / 1000.0,
        audio_fade_out_seconds=config.audio_fade_out_ms / 1000.0,
        audio_mode=EndCardAudioMode.silence.value,
        music_path=None,
        continue_from_seconds=None,
    )
