"""Tests for the mandatory end card: text fitting, duration and FFmpeg wiring."""

from __future__ import annotations

from pathlib import Path

import pytest
from app.models.end_card import (
    DEFAULT_AUDIO_FADE_OUT_MS,
    DEFAULT_END_CARD_SECONDS,
    DEFAULT_FADE_IN_MS,
    MAX_END_CARD_SECONDS,
    MIN_END_CARD_SECONDS,
    EndCardLayout,
)
from app.services.endcard.image import EndCardContent, render_end_card
from app.services.endcard.layout import (
    clamp_duration,
    fit_text,
    safe_area,
    wrap_text,
)
from app.services.render.args import (
    EndCardSpec,
    RenderSegmentSpec,
    build_render_command,
    resolve_end_card_audio_mode,
)
from PIL import Image


# Deterministic stand-in for real font metrics: every glyph is 10 px wide at
# size 10, scaling linearly with the font size.
def measure(text: str, font_size: int) -> int:
    return len(text) * font_size


# ---- text fitting -----------------------------------------------------------


def test_wrap_splits_on_words_within_width() -> None:
    lines = wrap_text(
        "gracia soberana para el pecador",
        max_width=100,
        font_size=10,
        measure=measure,
    )
    assert lines == ["gracia", "soberana", "para el", "pecador"]
    assert all(measure(line, 10) <= 100 for line in lines)


def test_wrap_breaks_a_word_longer_than_the_box() -> None:
    lines = wrap_text("incomprensibilidad", max_width=50, font_size=10, measure=measure)
    assert lines == ["incom", "prens", "ibili", "dad"]
    assert "".join(lines) == "incomprensibilidad"


def test_title_wraps_to_several_lines_without_shrinking_when_it_fits() -> None:
    fitted = fit_text(
        "La suficiencia de Cristo",
        max_width=120,
        max_height=400,
        max_lines=4,
        font_size=10,
        measure=measure,
    )
    assert len(fitted.lines) > 1
    assert fitted.font_size == 10
    assert fitted.truncated is False


def test_long_title_shrinks_until_it_fits_the_box() -> None:
    long_title = "La absoluta e inagotable suficiencia de Cristo para el creyente redimido"
    fitted = fit_text(
        long_title,
        max_width=200,
        max_height=120,
        max_lines=4,
        font_size=40,
        measure=measure,
        min_font_size=10,
    )
    assert fitted.font_size < 40
    assert len(fitted.lines) <= 4
    line_height = round(fitted.font_size * 1.22)
    assert line_height * len(fitted.lines) <= 120


def test_text_never_overflows_and_is_ellipsized_as_last_resort() -> None:
    fitted = fit_text(
        "palabra " * 60,
        max_width=100,
        max_height=40,
        max_lines=2,
        font_size=20,
        measure=measure,
        min_font_size=10,
    )
    assert fitted.truncated is True
    assert len(fitted.lines) <= 2
    assert fitted.lines[-1].endswith("…")
    assert all(measure(line, fitted.font_size) <= 100 for line in fitted.lines)


def test_empty_title_produces_no_lines() -> None:
    fitted = fit_text(
        "   ", max_width=100, max_height=100, max_lines=2, font_size=20, measure=measure
    )
    assert fitted.lines == []


def test_safe_area_keeps_margins_for_shorts_overlays() -> None:
    area = safe_area(1080, 1920)
    assert area.left > 0
    assert area.top > 0
    assert area.right < 1080
    # The bottom gap is larger than the top one: platform UI lives down there.
    assert 1920 - area.bottom > area.top
    assert area.center_x == 540


# ---- duration ---------------------------------------------------------------


def test_default_duration_is_five_seconds_within_bounds() -> None:
    assert DEFAULT_END_CARD_SECONDS == 5.0
    assert DEFAULT_FADE_IN_MS == 300
    assert DEFAULT_AUDIO_FADE_OUT_MS == 500
    assert MIN_END_CARD_SECONDS <= DEFAULT_END_CARD_SECONDS <= MAX_END_CARD_SECONDS


@pytest.mark.parametrize(
    ("requested", "expected"),
    [(0.0, 3.0), (2.9, 3.0), (3.0, 3.0), (5.0, 5.0), (8.0, 8.0), (12.0, 8.0)],
)
def test_duration_is_clamped_between_three_and_eight_seconds(
    requested: float, expected: float
) -> None:
    clamped = clamp_duration(requested, minimum=MIN_END_CARD_SECONDS, maximum=MAX_END_CARD_SECONDS)
    assert clamped == expected


# ---- image generation -------------------------------------------------------


@pytest.mark.parametrize("layout", list(EndCardLayout))
def test_every_layout_renders_at_canvas_size(layout: EndCardLayout) -> None:
    content = EndCardContent(
        sermon_title="La suficiencia de Cristo en la tribulación presente",
        church_name="Iglesia Gracia Soberana",
        channel_handle="@graciasoberana",
        url_text="https://example.org/sermon",
    )
    image = render_end_card(content=content, layout=layout, width=540, height=960)
    assert image.size == (540, 960)


def test_render_survives_a_missing_cover_file(tmp_path: Path) -> None:
    content = EndCardContent(
        sermon_title="Sin portada",
        church_name="Iglesia",
        channel_handle="@canal",
        cover_path=tmp_path / "does-not-exist.jpg",
    )
    image = render_end_card(content=content, layout=EndCardLayout.cover_full, width=270, height=480)
    assert image.size == (270, 480)


def test_end_card_ignores_title_identity_url_logo_and_qr() -> None:
    simple = EndCardContent(
        sermon_title="",
        church_name="",
        channel_handle="",
    )
    legacy_extras = EndCardContent(
        sermon_title="Título que ya no debe mostrarse",
        church_name="Iglesia que ya no debe mostrarse",
        channel_handle="@identificador",
        url_text="youtube.com/una-url",
        logo_path=Path("/tmp/logo-inexistente.png"),
        qr_url="https://youtube.com/watch?v=abc",
    )
    first = render_end_card(
        content=simple, layout=EndCardLayout.cover_card, width=270, height=480
    )
    second = render_end_card(
        content=legacy_extras, layout=EndCardLayout.cover_card, width=270, height=480
    )
    assert first.tobytes() == second.tobytes()


def test_end_card_layouts_keep_distinct_image_treatments(tmp_path: Path) -> None:
    cover = tmp_path / "wide-cover.png"
    Image.new("RGB", (400, 100), (210, 80, 30)).save(cover)
    content = EndCardContent(
        sermon_title="",
        church_name="",
        channel_handle="",
        cover_path=cover,
    )
    rendered = [
        render_end_card(content=content, layout=layout, width=270, height=480).tobytes()
        for layout in EndCardLayout
    ]
    assert len(set(rendered)) == len(EndCardLayout)


# ---- FFmpeg wiring ----------------------------------------------------------


def _plan(spec: EndCardSpec, *, has_audio: bool = True, segments=None):
    return build_render_command(
        ffmpeg="ffmpeg",
        source=Path("/tmp/source.mp4"),
        segments=segments
        or [
            RenderSegmentSpec(10.0, 20.0),
            RenderSegmentSpec(40.0, 70.0),
        ],
        aspect_ratio="9:16",
        layout="center_crop",
        output_path=Path("/tmp/out.mp4"),
        has_audio=has_audio,
        end_card=spec,
    )


def test_end_card_extends_expected_duration_and_concats_last() -> None:
    spec = EndCardSpec(image_path=Path("/tmp/card.png"), duration=5.0)
    plan = _plan(spec)

    # 10 s + 30 s of content, then 5 s of end card.
    assert plan.expected_duration_seconds == pytest.approx(45.0)
    assert "[ecv][eca]concat=n=2:v=1:a=1[vfinal][afinal]" in plan.filter_complex
    assert plan.args[plan.args.index("-map") + 1] == "[vfinal]"
    assert "-loop" in plan.args
    assert str(spec.image_path) in plan.args


def test_end_card_video_fades_in() -> None:
    spec = EndCardSpec(image_path=Path("/tmp/card.png"), duration=5.0, fade_in_seconds=0.3)
    plan = _plan(spec)
    assert "fade=t=in:st=0:d=0.3" in plan.filter_complex


def test_silence_mode_fades_the_main_audio_at_the_boundary() -> None:
    spec = EndCardSpec(
        image_path=Path("/tmp/card.png"),
        duration=4.0,
        audio_mode="silence",
        audio_fade_out_seconds=0.5,
    )
    plan = _plan(spec)
    # Main content is 40 s, so the fade starts at 39.5 s.
    assert "afade=t=out:st=39.5:d=0.5[amain]" in plan.filter_complex
    assert "anullsrc" in " ".join(plan.args)


def test_continue_mode_takes_tail_audio_from_the_source_instead() -> None:
    spec = EndCardSpec(
        image_path=Path("/tmp/card.png"),
        duration=5.0,
        audio_mode="continue_with_fade",
        audio_fade_out_seconds=0.5,
        continue_from_seconds=70.0,
    )
    plan = _plan(spec)
    # The tail is seeked at the end of the last segment.
    assert "70" in plan.args
    assert "[amain]" not in plan.filter_complex
    # The fade lands on the last frame of the card (5.0 - 0.5).
    assert "afade=t=out:st=4.5:d=0.5" in plan.filter_complex
    assert "anullsrc" not in " ".join(plan.args)


def test_continue_mode_degrades_to_silence_without_audio() -> None:
    spec = EndCardSpec(
        image_path=Path("/tmp/card.png"),
        duration=5.0,
        audio_mode="continue_with_fade",
        continue_from_seconds=70.0,
    )
    assert resolve_end_card_audio_mode(spec, has_audio=False) == "silence"

    plan = _plan(spec, has_audio=False)
    assert "anullsrc" in " ".join(plan.args)
    assert plan.expected_duration_seconds == pytest.approx(45.0)


def test_local_music_degrades_to_silence_when_no_file_was_provided() -> None:
    spec = EndCardSpec(image_path=Path("/tmp/card.png"), duration=5.0, audio_mode="local_music")
    assert resolve_end_card_audio_mode(spec, has_audio=True) == "silence"


def test_local_music_applies_volume_and_fades() -> None:
    spec = EndCardSpec(
        image_path=Path("/tmp/card.png"),
        duration=6.0,
        audio_mode="local_music",
        music_path=Path("/tmp/bed.mp3"),
        music_volume=0.4,
        fade_in_seconds=0.3,
        audio_fade_out_seconds=0.5,
    )
    plan = _plan(spec)
    assert str(spec.music_path) in plan.args
    assert "volume=0.4" in plan.filter_complex
    assert "afade=t=in:st=0:d=0.3" in plan.filter_complex
    assert "afade=t=out:st=5.5:d=0.5" in plan.filter_complex
    # Music replaces the main audio, which still fades out at the boundary.
    assert "[amain]" in plan.filter_complex


def test_subtitles_are_burned_before_the_end_card_concat() -> None:
    spec = EndCardSpec(image_path=Path("/tmp/card.png"), duration=5.0)
    plan = build_render_command(
        ffmpeg="ffmpeg",
        source=Path("/tmp/source.mp4"),
        segments=[RenderSegmentSpec(0.0, 12.0)],
        aspect_ratio="9:16",
        layout="center_crop",
        output_path=Path("/tmp/out.mp4"),
        has_audio=True,
        ass_path=Path("/tmp/subs.ass"),
        end_card=spec,
    )
    ass_at = plan.filter_complex.index("ass=")
    concat_at = plan.filter_complex.index("[ecv][eca]concat")
    assert ass_at < concat_at


def test_zero_duration_end_card_is_rejected() -> None:
    with pytest.raises(ValueError, match="end card duration"):
        _plan(EndCardSpec(image_path=Path("/tmp/card.png"), duration=0.0))
