"""FFmpeg argument construction for rendering a Reel.

Everything is produced as an explicit argument list for ``subprocess`` — never a
shell string — so no escaping/injection concerns arise (``shell=True`` is never
used). The graph normalizes every segment to the same resolution, frame rate,
pixel format and audio sample rate/layout before joining them, which is what
makes concatenating arbitrary non-consecutive windows safe.

Notes on correctness:
- Cuts are frame accurate because each segment re-encodes: ``-ss`` before ``-i``
  seeks to the preceding keyframe and FFmpeg then decodes and discards frames up
  to the exact timestamp (accurate seek). We never rely on ``-c copy``.
- Rotation stored in container metadata (display matrix) is applied
  automatically by FFmpeg's autorotate, so no manual ``transpose`` is needed.
- Variable frame rate sources are forced to a constant rate via the ``fps``
  filter, which is required for ``concat``/``xfade`` to behave predictably.
- Sources without audio get a generated silent track so the output always has a
  single, uniform audio stream.
"""

from __future__ import annotations

import shlex
from dataclasses import dataclass
from pathlib import Path
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from app.services.background_music.ffmpeg_filters import BackgroundMusicSpec

# Canvas size per aspect ratio.
CANVAS_SIZES: dict[str, tuple[int, int]] = {
    "9:16": (1080, 1920),
    "1:1": (1080, 1080),
    "16:9": (1920, 1080),
}

LAYOUT_CENTER_CROP = "center_crop"
LAYOUT_BLURRED_BACKGROUND = "blurred_background"
LAYOUT_AUTO_TRACK = "auto_track"
LAYOUT_MANUAL = "manual"
LAYOUTS: tuple[str, ...] = (
    LAYOUT_CENTER_CROP,
    LAYOUT_BLURRED_BACKGROUND,
    LAYOUT_AUTO_TRACK,
    LAYOUT_MANUAL,
)

# xfade transition name per domain transition type.
_XFADE_TRANSITIONS: dict[str, str] = {
    "short_crossfade": "fade",
    "dip_to_black": "fadeblack",
    "fade": "fade",
    "flash": "fadewhite",
}

TARGET_SAMPLE_RATE = 48000
TARGET_CHANNELS = 2
# A 3 ms edge ramp prevents clicks without audibly ducking speech at each cut.
BOUNDARY_FADE_SECONDS = 0.003
DEFAULT_FPS = 30.0
MIN_FPS = 12.0
MAX_FPS = 60.0
# Minimum slack kept around a crossfade so offsets stay positive.
_MIN_XFADE_SLACK = 0.05


@dataclass(frozen=True)
class RenderSegmentSpec:
    """A source window plus the transition that follows it."""

    start: float
    end: float
    transition_type: str = "hard_cut"
    transition_duration_ms: int = 0
    # Optional per-segment framing (from subject tracking / manual crop).
    layout_override: str | None = None
    crop_x: float | None = None
    crop_y: float | None = None
    crop_x_expr: str | None = None
    crop_y_expr: str | None = None

    @property
    def duration(self) -> float:
        return max(0.0, self.end - self.start)


@dataclass(frozen=True)
class EndCardSpec:
    """The mandatory closing screen appended after the main content.

    ``continue_from_seconds`` is the source position where the tail audio is
    taken from when the audio should keep playing over the card.
    """

    image_path: Path
    duration: float
    fade_in_seconds: float = 0.3
    audio_fade_out_seconds: float = 0.5
    audio_mode: str = "continue_with_fade"
    music_path: Path | None = None
    music_volume: float = 0.6
    continue_from_seconds: float | None = None
    # Optional trim window inside the music file (user-provided bed).
    music_start_seconds: float = 0.0
    music_end_seconds: float | None = None
    music_fade_in_seconds: float | None = None
    music_fade_out_seconds: float | None = None


@dataclass(frozen=True)
class OverlaySpec:
    """Image or pre-rendered title card placed on the main output clock."""

    path: Path
    start_seconds: float
    duration_seconds: float
    x: float = 0.5
    y: float = 0.5
    scale: float = 0.45
    opacity: float = 1.0


@dataclass(frozen=True)
class LoudnessSpec:
    """Spoken-word loudness target for the main timeline mix."""

    target_lufs: float = -16.0
    true_peak_db: float = -1.5
    lra: float = 11.0


@dataclass(frozen=True)
class RenderPlan:
    """Everything needed to run and monitor one render."""

    args: list[str]
    output_path: Path
    expected_duration_seconds: float
    filter_complex: str
    width: int
    height: int
    fps: float


def normalize_fps(fps: float | None) -> float:
    """Clamp a probed frame rate into a sane constant output rate."""
    if fps is None or fps <= 0:
        return DEFAULT_FPS
    return round(min(max(fps, MIN_FPS), MAX_FPS), 3)


def canvas_for(aspect_ratio: str) -> tuple[int, int]:
    try:
        return CANVAS_SIZES[aspect_ratio]
    except KeyError as exc:
        raise ValueError(f"Unsupported aspect ratio: {aspect_ratio!r}") from exc


def _fmt(value: float) -> str:
    """Format a float for FFmpeg without scientific notation."""
    return f"{value:.6f}".rstrip("0").rstrip(".") or "0"


def _video_chain(
    index: int,
    *,
    layout: str,
    width: int,
    height: int,
    fps: float,
    segment: RenderSegmentSpec | None = None,
) -> list[str]:
    """Per-segment video normalization chain, ending in label ``[v{index}]``."""
    # ``xfade`` emits AVTB (1/1,000,000) on current FFmpeg versions. Force
    # every incoming clip to that same timebase so a second consecutive xfade
    # does not compare AVTB against the fps filter's native 1/fps timebase.
    common = (
        f"setsar=1,fps={_fmt(fps)},settb=AVTB,"
        "format=yuv420p,setpts=PTS-STARTPTS"
    )
    effective = layout
    if segment is not None and segment.layout_override:
        effective = segment.layout_override

    if effective == LAYOUT_BLURRED_BACKGROUND:
        return [
            f"[{index}:v]split=2[bgsrc{index}][fgsrc{index}]",
            (
                f"[bgsrc{index}]scale={width}:{height}"
                f":force_original_aspect_ratio=increase,"
                f"crop={width}:{height},gblur=sigma=20[bg{index}]"
            ),
            (
                f"[fgsrc{index}]scale={width}:{height}"
                f":force_original_aspect_ratio=decrease[fg{index}]"
            ),
            (f"[bg{index}][fg{index}]overlay=(W-w)/2:(H-h)/2:shortest=1,{common}[v{index}]"),
        ]

    crop = _crop_filter(width=width, height=height, segment=segment)
    return [
        (
            f"[{index}:v]scale={width}:{height}"
            f":force_original_aspect_ratio=increase,"
            f"{crop},{common}[v{index}]"
        )
    ]


def _crop_filter(
    *,
    width: int,
    height: int,
    segment: RenderSegmentSpec | None,
) -> str:
    """Build a crop filter using static offsets or time expressions from tracking."""
    if segment is not None and segment.crop_x_expr and segment.crop_y_expr:
        return (
            f"crop={width}:{height}"
            f":'{segment.crop_x_expr}':'{segment.crop_y_expr}'"
        )
    if segment is not None and segment.crop_x is not None and segment.crop_y is not None:
        return f"crop={width}:{height}:{_fmt(segment.crop_x)}:{_fmt(segment.crop_y)}"
    # Default FFmpeg centre crop.
    return f"crop={width}:{height}"


def _audio_chain(
    stream: str,
    index: int,
    duration: float,
    *,
    delay_seconds: float = 0.0,
) -> str:
    """Per-segment audio normalization chain, ending in label ``[a{index}]``.

    Mono/stereo/other layouts are converted to a fixed stereo 48 kHz stream, and
    a ~15 ms fade is applied at both edges so joins never click.
    """
    fade = min(BOUNDARY_FADE_SECONDS, max(duration / 4.0, 0.0))
    parts = [
        f"[{stream}]aformat=sample_fmts=fltp:sample_rates={TARGET_SAMPLE_RATE}"
        f":channel_layouts=stereo",
        f"aresample={TARGET_SAMPLE_RATE}",
        "asetpts=PTS-STARTPTS",
    ]
    if delay_seconds > 0:
        parts.append(f"adelay={round(delay_seconds * 1000)}:all=1")
    # An advanced offset can seek close to the beginning/end of the source.
    # Always produce the exact clip duration, filling unavailable audio with silence.
    parts.append(f"apad=whole_dur={_fmt(duration)}")
    parts.append(f"atrim=0:{_fmt(duration)}")
    if fade > 0:
        parts.append(f"afade=t=in:st=0:d={_fmt(fade)}")
        fade_out_start = max(0.0, duration - fade)
        parts.append(f"afade=t=out:st={_fmt(fade_out_start)}:d={_fmt(fade)}")
    return ",".join(parts) + f"[a{index}]"


def _join_chain(segments: list[RenderSegmentSpec]) -> tuple[list[str], str, str, float]:
    """Fold normalized segments left-to-right into a single A/V pair.

    Each join is either a plain ``concat`` (hard cut) or a matched
    ``xfade``/``acrossfade`` pair using the *same* duration, which keeps audio
    and video in sync because both streams shrink by exactly the same amount.
    """
    lines: list[str] = []
    current_v = "v0"
    current_a = "a0"
    total = segments[0].duration

    for index in range(1, len(segments)):
        previous = segments[index - 1]
        segment = segments[index]
        requested = max(0, previous.transition_duration_ms) / 1000.0
        transition = _XFADE_TRANSITIONS.get(previous.transition_type)

        # Keep the crossfade shorter than either side so the offset stays valid.
        usable = min(
            requested,
            total - _MIN_XFADE_SLACK,
            segment.duration - _MIN_XFADE_SLACK,
        )

        if transition is None or usable <= 0:
            lines.append(
                f"[{current_v}][{current_a}][v{index}][a{index}]"
                f"concat=n=2:v=1:a=1[cv{index}][ca{index}]"
            )
            total += segment.duration
        else:
            offset = total - usable
            lines.append(
                f"[{current_v}][v{index}]xfade=transition={transition}"
                f":duration={_fmt(usable)}:offset={_fmt(offset)}[cv{index}]"
            )
            lines.append(
                f"[{current_a}][a{index}]acrossfade=d={_fmt(usable)}:c1=tri:c2=tri[ca{index}]"
            )
            total += segment.duration - usable

        current_v = f"cv{index}"
        current_a = f"ca{index}"

    return lines, current_v, current_a, total


AUDIO_SILENCE = "silence"
AUDIO_CONTINUE_WITH_FADE = "continue_with_fade"
AUDIO_LOCAL_MUSIC = "local_music"


def resolve_end_card_audio_mode(spec: EndCardSpec, *, has_audio: bool) -> str:
    """Degrade the requested audio mode to what is actually available."""
    mode = spec.audio_mode
    if mode == AUDIO_CONTINUE_WITH_FADE and (not has_audio or spec.continue_from_seconds is None):
        return AUDIO_SILENCE
    if mode == AUDIO_LOCAL_MUSIC and spec.music_path is None:
        return AUDIO_SILENCE
    known = {AUDIO_SILENCE, AUDIO_CONTINUE_WITH_FADE, AUDIO_LOCAL_MUSIC}
    return mode if mode in known else AUDIO_SILENCE


def _end_card_inputs(
    spec: EndCardSpec,
    *,
    source: Path,
    mode: str,
    fps: float,
) -> list[str]:
    """Input arguments for the end card image and its audio bed."""
    duration = _fmt(spec.duration)
    args = [
        "-loop",
        "1",
        "-framerate",
        _fmt(fps),
        "-t",
        duration,
        "-i",
        str(spec.image_path),
    ]
    if mode == AUDIO_CONTINUE_WITH_FADE:
        args += [
            "-accurate_seek",
            "-ss",
            _fmt(spec.continue_from_seconds or 0.0),
            "-t",
            duration,
            "-i",
            str(source),
        ]
    elif mode == AUDIO_LOCAL_MUSIC and spec.music_path is not None:
        args += ["-t", duration, "-i", str(spec.music_path)]
    else:
        args += [
            "-f",
            "lavfi",
            "-t",
            duration,
            "-i",
            f"anullsrc=channel_layout=stereo:sample_rate={TARGET_SAMPLE_RATE}",
        ]
    return args


def _end_card_chains(
    spec: EndCardSpec,
    *,
    mode: str,
    image_index: int,
    audio_index: int,
    width: int,
    height: int,
    fps: float,
) -> list[str]:
    """Normalization chains for the end card, ending in ``[ecv]`` / ``[eca]``."""
    duration = spec.duration
    fade_in = max(0.0, min(spec.fade_in_seconds, duration))
    fade_out = max(0.0, min(spec.audio_fade_out_seconds, duration))

    video = (
        f"[{image_index}:v]scale={width}:{height}"
        f":force_original_aspect_ratio=decrease,"
        f"pad={width}:{height}:(ow-iw)/2:(oh-ih)/2,"
        f"setsar=1,fps={_fmt(fps)},settb=AVTB,"
        "format=yuv420p,setpts=PTS-STARTPTS"
    )
    if fade_in > 0:
        video += f",fade=t=in:st=0:d={_fmt(fade_in)}"
    lines = [f"{video}[ecv]"]

    audio_parts = [
        f"[{audio_index}:a]aformat=sample_fmts=fltp:sample_rates={TARGET_SAMPLE_RATE}"
        f":channel_layouts=stereo",
        f"aresample={TARGET_SAMPLE_RATE}",
    ]
    if mode == AUDIO_LOCAL_MUSIC:
        start = max(0.0, spec.music_start_seconds)
        end = spec.music_end_seconds
        if end is not None and end > start:
            audio_parts.append(f"atrim={_fmt(start)}:{_fmt(end)}")
            audio_parts.append("asetpts=PTS-STARTPTS")
        elif start > 0:
            audio_parts.append(f"atrim=start={_fmt(start)}")
            audio_parts.append("asetpts=PTS-STARTPTS")
    audio_parts += [
        # Pad short beds (or a source that ended early) so the card keeps its length.
        f"apad=whole_dur={_fmt(duration)}",
        f"atrim=0:{_fmt(duration)}",
        "asetpts=PTS-STARTPTS",
    ]
    if mode == AUDIO_LOCAL_MUSIC:
        audio_parts.append(f"volume={_fmt(max(0.0, min(1.0, spec.music_volume)))}")
        fade_in_music = (
            spec.music_fade_in_seconds
            if spec.music_fade_in_seconds is not None
            else fade_in
        )
        fade_in_music = max(0.0, min(fade_in_music, duration))
        if fade_in_music > 0:
            audio_parts.append(f"afade=t=in:st=0:d={_fmt(fade_in_music)}")
    fade_out_music = (
        spec.music_fade_out_seconds
        if mode == AUDIO_LOCAL_MUSIC and spec.music_fade_out_seconds is not None
        else fade_out
    )
    if mode in {AUDIO_CONTINUE_WITH_FADE, AUDIO_LOCAL_MUSIC} and fade_out_music > 0:
        # Land the fade exactly on the last frame of the card.
        fo = max(0.0, min(fade_out_music, duration))
        audio_parts.append(f"afade=t=out:st={_fmt(duration - fo)}:d={_fmt(fo)}")
    lines.append(",".join(audio_parts) + "[eca]")
    return lines


def escape_filter_path(path: Path) -> str:
    """Escape a filesystem path for embedding inside an FFmpeg filtergraph."""
    text = path.resolve().as_posix()
    escaped = (
        text.replace("\\", "\\\\")
        .replace(":", "\\:")
        .replace("'", "\\'")
        .replace("[", "\\[")
        .replace("]", "\\]")
        .replace(",", "\\,")
        .replace(";", "\\;")
    )
    # Paths in ``-filter_complex`` are parsed once more by libavfilter.
    # Quoting the complete value preserves spaces such as "Mobile Documents".
    return f"'{escaped}'"


def _overlay_enable_expr(start: float, end: float) -> str:
    """FFmpeg enable expression for an overlay time window."""
    return f"between(t\\,{_fmt(start)}\\,{_fmt(end)})"


def apply_overlays(
    *,
    video_label: str,
    overlays: list[OverlaySpec],
    input_start_index: int,
    canvas_width: int,
    canvas_height: int,
) -> tuple[list[str], list[str], str, int]:
    """Build input args + filter lines that composite overlays onto ``video_label``.

    Returns ``(input_args, filter_lines, new_video_label, next_input_index)``.
    """
    if not overlays:
        return [], [], video_label, input_start_index

    input_args: list[str] = []
    filters: list[str] = []
    current = video_label
    next_index = input_start_index
    short_side = min(canvas_width, canvas_height)

    for index, overlay in enumerate(overlays):
        if overlay.duration_seconds <= 0 or not overlay.path.is_file():
            continue
        input_args += [
            "-loop",
            "1",
            "-t",
            _fmt(overlay.duration_seconds),
            "-i",
            str(overlay.path),
        ]
        target_w = max(8, int(round(short_side * max(0.05, overlay.scale))))
        ov_in = f"{next_index}:v"
        scaled = f"ovsc{index}"
        out = f"ovout{index}"
        opacity = max(0.05, min(1.0, overlay.opacity))
        filters.append(
            f"[{ov_in}]scale={target_w}:-1:force_original_aspect_ratio=decrease,"
            f"format=rgba,colorchannelmixer=aa={_fmt(opacity)}[{scaled}]"
        )
        start = max(0.0, overlay.start_seconds)
        end = start + max(0.05, overlay.duration_seconds)
        x_expr = f"(W-w)*{_fmt(max(0.0, min(1.0, overlay.x)))}"
        y_expr = f"(H-h)*{_fmt(max(0.0, min(1.0, overlay.y)))}"
        filters.append(
            f"[{current}][{scaled}]overlay=x={x_expr}:y={y_expr}:"
            f"enable='{_overlay_enable_expr(start, end)}'[{out}]"
        )
        current = out
        next_index += 1

    return input_args, filters, current, next_index


def build_render_command(
    *,
    ffmpeg: str,
    source: Path,
    segments: list[RenderSegmentSpec],
    aspect_ratio: str,
    layout: str,
    output_path: Path,
    has_audio: bool,
    fps: float | None = None,
    normalize_loudness: bool = True,
    crf: int = 20,
    preset: str = "medium",
    audio_bitrate_k: int = 192,
    canvas_width: int | None = None,
    canvas_height: int | None = None,
    ass_path: Path | None = None,
    fonts_dir: Path | None = None,
    end_card: EndCardSpec | None = None,
    background_music: BackgroundMusicSpec | None = None,
    loudness: LoudnessSpec | None = None,
    audio_offset_ms: int = 0,
    overlays: list[OverlaySpec] | None = None,
) -> RenderPlan:
    """Build the full FFmpeg argument list for one reel render.

    Produces MP4 (H.264 + AAC). When ``ass_path`` is set, burns subtitles with
    libass via the ``ass`` filter. When ``end_card`` is set, its pre-rendered PNG
    is appended after the main content — subtitles are burned before that concat,
    so cue times stay relative to the main timeline.

    ``background_music`` is only mixed into the *main* timeline when its scope is
    ``full_reel``. End-card-only beds are expected to be wired via ``end_card``.
    """
    # Local import avoids a circular dependency with the background_music package.
    from app.models.background_music import BackgroundMusicScope
    from app.services.background_music.ffmpeg_filters import (
        ALIMITER,
        build_background_music_graph,
        build_loudnorm_filter,
    )

    if not segments:
        raise ValueError("A render needs at least one segment.")
    if layout not in LAYOUTS:
        raise ValueError(f"Unsupported layout: {layout!r}")
    allowed_presets = {
        "ultrafast",
        "superfast",
        "veryfast",
        "faster",
        "fast",
        "medium",
        "slow",
        "slower",
        "veryslow",
    }
    if preset not in allowed_presets:
        preset = "medium"
    for index, segment in enumerate(segments):
        if segment.duration <= 0:
            raise ValueError(f"Segment {index + 1} has a non-positive duration.")

    width, height = canvas_for(aspect_ratio)
    if canvas_width is not None and canvas_height is not None:
        width, height = int(canvas_width), int(canvas_height)
    output_fps = normalize_fps(fps)
    loud = loudness or LoudnessSpec()

    if end_card is not None and end_card.duration <= 0:
        raise ValueError("The end card duration must be positive.")
    if not -1000 <= audio_offset_ms <= 1000:
        raise ValueError("Audio offset must be between -1000 and 1000 ms.")

    full_reel_music: BackgroundMusicSpec | None = None
    if background_music is not None and background_music.scope == BackgroundMusicScope.full_reel:
        full_reel_music = background_music

    args: list[str] = [ffmpeg, "-hide_banner", "-nostdin", "-loglevel", "error"]

    # One input per segment: accurate seek + bounded duration.
    for segment in segments:
        args += [
            "-accurate_seek",
            "-ss",
            _fmt(segment.start),
            "-t",
            _fmt(segment.duration),
            "-i",
            str(source),
        ]

    audio_offset_seconds = audio_offset_ms / 1000.0
    separate_audio_inputs = has_audio and audio_offset_ms != 0
    audio_input_delays: list[float] = [0.0] * len(segments)
    if separate_audio_inputs:
        for index, segment in enumerate(segments):
            desired_start = segment.start - audio_offset_seconds
            audio_start = max(0.0, desired_start)
            audio_input_delays[index] = max(0.0, -desired_start)
            args += [
                "-accurate_seek",
                "-ss",
                _fmt(audio_start),
                "-t",
                _fmt(segment.duration),
                "-i",
                str(source),
            ]

    # Silent stand-ins when the source carries no audio at all.
    if not has_audio:
        for segment in segments:
            args += [
                "-f",
                "lavfi",
                "-t",
                _fmt(segment.duration),
                "-i",
                f"anullsrc=channel_layout=stereo:sample_rate={TARGET_SAMPLE_RATE}",
            ]

    count = len(segments)
    next_input = count * (2 if separate_audio_inputs or not has_audio else 1)
    music_input_index: int | None = None
    if full_reel_music is not None:
        # Never loop a short music file: repeating a recognisable passage is
        # distracting and can make the export sound accidental. The prep
        # filter pads the remainder with silence instead.
        args += ["-i", str(full_reel_music.path)]
        music_input_index = next_input
        next_input += 1

    overlay_list = [item for item in (overlays or []) if item.duration_seconds > 0]
    overlay_start_index = next_input
    overlay_input_args, _, _, next_input = apply_overlays(
        video_label="v0",
        overlays=overlay_list,
        input_start_index=overlay_start_index,
        canvas_width=width,
        canvas_height=height,
    )
    args += overlay_input_args

    end_card_mode: str | None = None
    end_card_image_index: int | None = None
    if end_card is not None:
        end_card_mode = resolve_end_card_audio_mode(end_card, has_audio=has_audio)
        end_card_image_index = next_input
        args += _end_card_inputs(end_card, source=source, mode=end_card_mode, fps=output_fps)

    filters: list[str] = []
    for index, segment in enumerate(segments):
        filters += _video_chain(
            index,
            layout=layout,
            width=width,
            height=height,
            fps=output_fps,
            segment=segment,
        )
        if separate_audio_inputs:
            audio_stream = f"{count + index}:a"
        else:
            audio_stream = f"{index}:a" if has_audio else f"{count + index}:a"
        filters.append(
            _audio_chain(
                audio_stream,
                index,
                segment.duration,
                delay_seconds=audio_input_delays[index],
            )
        )

    if count == 1:
        video_label, audio_label = "v0", "a0"
        expected = segments[0].duration
    else:
        join_lines, video_label, audio_label, expected = _join_chain(segments)
        filters += join_lines

    if overlay_list:
        _, overlay_filters, video_label, _ = apply_overlays(
            video_label=video_label,
            overlays=overlay_list,
            input_start_index=overlay_start_index,
            canvas_width=width,
            canvas_height=height,
        )
        filters += overlay_filters

    if ass_path is not None:
        ass_filter = f"ass={escape_filter_path(ass_path)}"
        if fonts_dir is not None:
            ass_filter += f":fontsdir={escape_filter_path(fonts_dir)}"
        filters.append(f"[{video_label}]{ass_filter}[vout]")
        video_label = "vout"

    if full_reel_music is not None and music_input_index is not None:
        mix_lines, audio_label = build_background_music_graph(
            voice_label=audio_label,
            music_input_index=music_input_index,
            spec=full_reel_music,
            main_duration=expected,
            normalize_loudness=normalize_loudness,
        )
        filters += mix_lines
    elif normalize_loudness:
        # Limiter first, then loudnorm — spoken-word defaults, configurable LUFS.
        loud_filter = build_loudnorm_filter(
            target_lufs=loud.target_lufs,
            true_peak_db=loud.true_peak_db,
            lra=loud.lra,
        )
        filters.append(f"[{audio_label}]{ALIMITER}[alim]")
        filters.append(f"[alim]{loud_filter}[aout]")
        audio_label = "aout"

    if end_card is not None and end_card_mode is not None and end_card_image_index is not None:
        # The main audio only fades at the boundary when the card does not carry
        # it over; in continue mode the fade happens inside the card instead.
        main_fade = (
            0.0
            if end_card_mode == AUDIO_CONTINUE_WITH_FADE
            else max(0.0, min(end_card.audio_fade_out_seconds, expected))
        )
        if main_fade > 0:
            filters.append(
                f"[{audio_label}]afade=t=out:st={_fmt(expected - main_fade)}"
                f":d={_fmt(main_fade)}[amain]"
            )
            audio_label = "amain"

        image_index = end_card_image_index
        filters += _end_card_chains(
            end_card,
            mode=end_card_mode,
            image_index=image_index,
            audio_index=image_index + 1,
            width=width,
            height=height,
            fps=output_fps,
        )
        filters.append(
            f"[{video_label}][{audio_label}][ecv][eca]concat=n=2:v=1:a=1[vfinal][afinal]"
        )
        video_label, audio_label = "vfinal", "afinal"
        expected += end_card.duration

    filter_complex = ";".join(filters)

    args += [
        "-filter_complex",
        filter_complex,
        "-map",
        f"[{video_label}]",
        "-map",
        f"[{audio_label}]",
        "-c:v",
        "libx264",
        "-preset",
        preset,
        "-crf",
        str(crf),
        "-pix_fmt",
        "yuv420p",
        "-profile:v",
        "high",
        "-r",
        _fmt(output_fps),
        "-c:a",
        "aac",
        "-b:a",
        f"{max(64, min(320, int(audio_bitrate_k)))}k",
        "-ar",
        str(TARGET_SAMPLE_RATE),
        "-ac",
        str(TARGET_CHANNELS),
        "-movflags",
        "+faststart",
        # Machine-readable progress on stdout for the job manager.
        "-progress",
        "pipe:1",
        "-nostats",
        str(output_path),
    ]

    return RenderPlan(
        args=args,
        output_path=output_path,
        expected_duration_seconds=expected,
        filter_complex=filter_complex,
        width=width,
        height=height,
        fps=output_fps,
    )


def format_command_for_log(args: list[str]) -> str:
    """Return a safely quoted, copy-pasteable rendition of the command.

    Used only for debugging output; the process itself always receives the
    argument list directly.
    """
    return shlex.join(args)
