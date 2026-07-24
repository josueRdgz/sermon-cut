"""Parse yt-dlp ``--dump-single-json`` metadata into a small preview object.

Only a curated, non-sensitive subset is surfaced. Large payloads (full format
tables, subtitles, per-fragment data) stay out of the DB and the API.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from app.core.exceptions import ValidationAppError


@dataclass(frozen=True)
class YouTubePreview:
    """A safe, compact preview of a YouTube video."""

    video_id: str
    title: str | None
    channel: str | None
    duration_seconds: float | None
    thumbnail_url: str | None
    resolution_label: str | None
    upload_date: str | None  # ISO ``YYYY-MM-DD`` when known.
    is_live: bool
    live_status: str | None


class YouTubeMetadataError(ValidationAppError):
    """The metadata describes something we cannot import."""

    def __init__(self, message: str, *, code: str) -> None:
        super().__init__(message, code=code)


def _pick_thumbnail(payload: dict[str, Any]) -> str | None:
    thumb = payload.get("thumbnail")
    if isinstance(thumb, str) and thumb.startswith(("http://", "https://")):
        return thumb
    thumbnails = payload.get("thumbnails")
    if isinstance(thumbnails, list):
        # Prefer the last (usually highest-res) http(s) thumbnail.
        for item in reversed(thumbnails):
            url = item.get("url") if isinstance(item, dict) else None
            if isinstance(url, str) and url.startswith(("http://", "https://")):
                return url
    return None


def _format_upload_date(raw: Any) -> str | None:
    if not isinstance(raw, str) or len(raw) != 8 or not raw.isdigit():
        return None
    return f"{raw[0:4]}-{raw[4:6]}-{raw[6:8]}"


def _best_height(payload: dict[str, Any]) -> int | None:
    height = payload.get("height")
    best = int(height) if isinstance(height, int) and height > 0 else None
    formats = payload.get("formats")
    if isinstance(formats, list):
        for fmt in formats:
            if not isinstance(fmt, dict):
                continue
            fh = fmt.get("height")
            if isinstance(fh, int) and fh > 0 and (best is None or fh > best):
                best = fh
    return best


def _has_downloadable_video(payload: dict[str, Any]) -> bool:
    formats = payload.get("formats")
    if not isinstance(formats, list) or not formats:
        # Some extractors put a single stream at the top level.
        return bool(payload.get("url"))
    for fmt in formats:
        if not isinstance(fmt, dict):
            continue
        vcodec = fmt.get("vcodec")
        if vcodec and vcodec != "none":
            return True
    return False


def parse_preview(payload: dict[str, Any]) -> YouTubePreview:
    """Build a :class:`YouTubePreview` from a raw yt-dlp JSON dict."""
    height = _best_height(payload)
    resolution_label = f"{height}p" if height else None
    channel = payload.get("channel") or payload.get("uploader") or payload.get("uploader_id")

    return YouTubePreview(
        video_id=str(payload.get("id") or ""),
        title=payload.get("title"),
        channel=channel if isinstance(channel, str) else None,
        duration_seconds=(
            float(payload["duration"])
            if isinstance(payload.get("duration"), (int, float))
            else None
        ),
        thumbnail_url=_pick_thumbnail(payload),
        resolution_label=resolution_label,
        upload_date=_format_upload_date(payload.get("upload_date")),
        is_live=bool(payload.get("is_live")),
        live_status=payload.get("live_status") if isinstance(payload.get("live_status"), str)
        else None,
    )


def assert_importable(
    preview: YouTubePreview,
    payload: dict[str, Any],
    *,
    max_duration_seconds: int,
) -> None:
    """Raise :class:`YouTubeMetadataError` when the video cannot be imported.

    Rejects active/upcoming live streams, videos with no downloadable video
    stream, and anything exceeding the configured maximum duration.
    """
    status = (preview.live_status or "").lower()
    if preview.is_live or status == "is_live":
        raise YouTubeMetadataError(
            "Es una transmisión en vivo activa. Espera a que finalice para importarla.",
            code="youtube_live_active",
        )
    if status in {"is_upcoming", "post_live"}:
        raise YouTubeMetadataError(
            "La transmisión aún no ha finalizado. Inténtalo cuando termine.",
            code="youtube_live_upcoming",
        )

    if not _has_downloadable_video(payload):
        raise YouTubeMetadataError(
            "El video no tiene streams descargables disponibles.",
            code="youtube_no_streams",
        )

    duration = preview.duration_seconds
    if duration is not None and duration > max_duration_seconds:
        limit_min = round(max_duration_seconds / 60)
        raise YouTubeMetadataError(
            f"El video supera la duración máxima permitida ({limit_min} min).",
            code="youtube_too_long",
        )
