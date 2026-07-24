"""Syntactic + domain validation for YouTube URLs (SSRF-safe).

This is the *first* gate. It never guarantees the video exists or is
downloadable — that is confirmed later by yt-dlp metadata extraction. Its job is
to reject anything that is clearly not a single YouTube video before we ever
spawn a subprocess: other domains, ``file://``, localhost/private hosts,
playlists, channels and search pages.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from urllib.parse import parse_qs, urlparse

from app.core.exceptions import ValidationAppError

# Hosts we accept. Everything else (including look-alikes) is rejected.
_ALLOWED_HOSTS: frozenset[str] = frozenset(
    {
        "youtube.com",
        "www.youtube.com",
        "m.youtube.com",
        "music.youtube.com",
        "youtu.be",
        "www.youtu.be",
    }
)

# YouTube video ids are 11 chars from a fixed alphabet.
_VIDEO_ID_RE = re.compile(r"^[A-Za-z0-9_-]{11}$")

# Path prefixes that carry a video id as the next path segment.
_PATH_ID_PREFIXES: tuple[str, ...] = ("shorts", "live", "embed", "v")

_CHANNEL_MARKERS: frozenset[str] = frozenset({"channel", "c", "user", "playlist", "results"})


class YouTubeUrlError(ValidationAppError):
    """A URL that is not an importable single YouTube video."""

    def __init__(self, message: str, *, code: str = "youtube_invalid_url") -> None:
        super().__init__(message, code=code)


@dataclass(frozen=True)
class ValidatedYouTubeUrl:
    """A validated, canonicalized single-video reference."""

    video_id: str
    # Canonical watch URL passed to yt-dlp (never the original playlist URL).
    canonical_url: str
    # True when the original URL also carried a playlist (``list=``) parameter.
    had_playlist: bool


def _clean_host(netloc: str) -> str:
    host = netloc.lower()
    # Drop credentials and port if present (user:pass@host:port).
    if "@" in host:
        host = host.rsplit("@", 1)[1]
    if ":" in host:
        host = host.rsplit(":", 1)[0]
    return host


def _extract_video_id(parsed: object, query: dict[str, list[str]], host: str) -> str | None:
    path = getattr(parsed, "path", "") or ""
    segments = [seg for seg in path.split("/") if seg]

    # youtu.be/<id>
    if host in {"youtu.be", "www.youtu.be"}:
        return segments[0] if segments else None

    # /watch?v=<id>
    if segments[:1] == ["watch"]:
        values = query.get("v")
        return values[0] if values else None

    # /shorts/<id>, /live/<id>, /embed/<id>, /v/<id>
    if len(segments) >= 2 and segments[0] in _PATH_ID_PREFIXES:
        return segments[1]

    return None


def validate_youtube_url(raw_url: str) -> ValidatedYouTubeUrl:
    """Validate a user-provided URL and return a canonical single-video ref.

    Raises ``YouTubeUrlError`` with a specific ``code`` for every rejected case.
    """
    if not raw_url or not raw_url.strip():
        raise YouTubeUrlError("Introduce una URL de YouTube.", code="youtube_empty_url")

    candidate = raw_url.strip()
    parsed = urlparse(candidate)

    # SSRF / scheme guard: only https/http, never file://, data:, localhost, etc.
    if parsed.scheme not in {"http", "https"}:
        raise YouTubeUrlError(
            "Solo se aceptan enlaces http(s) de YouTube.",
            code="youtube_bad_scheme",
        )

    host = _clean_host(parsed.netloc)
    if not host:
        raise YouTubeUrlError("La URL no tiene un dominio válido.", code="youtube_bad_host")

    if host not in _ALLOWED_HOSTS:
        raise YouTubeUrlError(
            "La URL debe pertenecer a youtube.com o youtu.be.",
            code="youtube_not_youtube",
        )

    segments = [seg for seg in (parsed.path or "").split("/") if seg]
    first = segments[0].lower() if segments else ""

    # Explicit rejections for channels / search / bare playlists.
    if first in _CHANNEL_MARKERS or first.startswith("@"):
        if first == "playlist":
            raise YouTubeUrlError(
                "Es una lista de reproducción completa. Pega el enlace de un video.",
                code="youtube_playlist",
            )
        if first == "results":
            raise YouTubeUrlError(
                "Es una página de búsqueda, no un video.",
                code="youtube_search",
            )
        raise YouTubeUrlError(
            "Es un canal, no un video. Pega el enlace de un video individual.",
            code="youtube_channel",
        )

    query = parse_qs(parsed.query or "")
    video_id = _extract_video_id(parsed, query, host)

    if not video_id:
        # watch?list=... without v, or unknown path shape.
        if "list" in query and "v" not in query:
            raise YouTubeUrlError(
                "El enlace apunta a una lista, no a un video. Abre un video y copia su URL.",
                code="youtube_playlist",
            )
        raise YouTubeUrlError(
            "No se pudo identificar un video de YouTube en la URL.",
            code="youtube_no_video_id",
        )

    if not _VIDEO_ID_RE.match(video_id):
        raise YouTubeUrlError(
            "El identificador del video no es válido.",
            code="youtube_bad_video_id",
        )

    had_playlist = "list" in query
    canonical = f"https://www.youtube.com/watch?v={video_id}"
    return ValidatedYouTubeUrl(
        video_id=video_id,
        canonical_url=canonical,
        had_playlist=had_playlist,
    )
