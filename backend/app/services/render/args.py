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

# Canvas size per aspect ratio.
CANVAS_SIZES: dict[str, tuple[int, int]] = {
    "9:16": (1080, 1920),
    "1:1": (1080, 1080),
    "16:9": (1920, 1080),
}

LAYOUT_CENTER_CROP = "center_crop"
LAYOUT_BLURRED_BACKGROUND = "blurred_background"
LAYOUTS: tuple[str, ...] = (LAYOUT_CENTER_CROP, LAYOUT_BLURRED_BACKGROUND)

# xfade transition name per domain transition type.
_XFADE_TRANSITIONS: dict[str, str] = {
    "short_crossfade": "fade",
    "dip_to_black": "fadeblack",
}

TARGET_SAMPLE_RATE = 48000
TARGET_CHANNELS = 2
# Very short fade at each segment boundary to avoid audible clicks.
BOUNDARY_FADE_SECONDS = 0.015
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

    @property
    def duration(self) -> float:
        return max(0.0, self.end - self.start)


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


def _video_chain(index: int, *, layout: str, width: int, height: int, fps: float) -> list[str]:
    """Per-segment video normalization chain, ending in label ``[v{index}]``."""
    common = f"setsar=1,fps={_fmt(fps)},format=yuv420p,setpts=PTS-STARTPTS"

    if layout == LAYOUT_BLURRED_BACKGROUND:
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
            (
                f"[bg{index}][fg{index}]overlay=(W-w)/2:(H-h)/2:shortest=1,"
                f"{common}[v{index}]"
            ),
        ]

    # center_crop: scale to cover the canvas, then crop the centre.
    return [
        (
            f"[{index}:v]scale={width}:{height}"
            f":force_original_aspect_ratio=increase,"
            f"crop={width}:{height},{common}[v{index}]"
        )
    ]


def _audio_chain(stream: str, index: int, duration: float) -> str:
    """Per-segment audio normalization chain, ending in label ``[a{index}]``.

    Mono/stereo/other layouts are converted to a fixed stereo 48 kHz stream, and
    a ~15 ms fade is applied at both edges so joins never click.
    """
    fade = min(BOUNDARY_FADE_SECONDS, max(duration / 4.0, 0.0))
    parts = [
        f"[{stream}]aformat=sample_fmts=fltp:sample_rates={TARGET_SAMPLE_RATE}"
        f":channel_layouts=stereo",
        f"aresample={TARGET_SAMPLE_RATE}:async=1",
        "asetpts=PTS-STARTPTS",
    ]
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
                f"[{current_a}][a{index}]acrossfade=d={_fmt(usable)}:c1=tri:c2=tri"
                f"[ca{index}]"
            )
            total += segment.duration - usable

        current_v = f"cv{index}"
        current_a = f"ca{index}"

    return lines, current_v, current_a, total


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
) -> RenderPlan:
    """Build the full FFmpeg argument list for one reel render.

    Produces MP4 (H.264 + AAC). Subtitles and end screens are intentionally out
    of scope for this first render.
    """
    if not segments:
        raise ValueError("A render needs at least one segment.")
    if layout not in LAYOUTS:
        raise ValueError(f"Unsupported layout: {layout!r}")
    for index, segment in enumerate(segments):
        if segment.duration <= 0:
            raise ValueError(f"Segment {index + 1} has a non-positive duration.")

    width, height = canvas_for(aspect_ratio)
    output_fps = normalize_fps(fps)

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
    filters: list[str] = []
    for index, segment in enumerate(segments):
        filters += _video_chain(
            index, layout=layout, width=width, height=height, fps=output_fps
        )
        audio_stream = f"{index}:a" if has_audio else f"{count + index}:a"
        filters.append(_audio_chain(audio_stream, index, segment.duration))

    if count == 1:
        video_label, audio_label = "v0", "a0"
        expected = segments[0].duration
    else:
        join_lines, video_label, audio_label, expected = _join_chain(segments)
        filters += join_lines

    if normalize_loudness:
        filters.append(f"[{audio_label}]loudnorm=I=-16:TP=-1.5:LRA=11[aout]")
        audio_label = "aout"

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
        "192k",
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
