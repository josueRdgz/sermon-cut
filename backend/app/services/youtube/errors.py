"""Translate raw yt-dlp output into stable error codes + safe messages.

The frontend only ever receives ``(code, message)``. Raw stderr — which can
contain absolute paths, full command lines or cookie hints — stays in the local
log file and is never returned.
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class YouTubeError:
    code: str
    message: str


# Ordered (substring -> error). First match wins, so put specific cases first.
# Substrings are matched case-insensitively against the yt-dlp stderr tail.
_PATTERNS: tuple[tuple[tuple[str, ...], str, str], ...] = (
    (
        ("is not a valid url", "unsupported url"),
        "youtube_invalid_url",
        "La URL no es válida o no corresponde a un video de YouTube.",
    ),
    (
        ("private video", "this video is private"),
        "youtube_private",
        "El video es privado. Necesitarías autorización del propietario.",
    ),
    (
        ("video unavailable", "does not exist", "has been removed", "no longer available"),
        "youtube_unavailable",
        "El video no existe o ya no está disponible.",
    ),
    (
        ("sign in to confirm your age", "age-restricted", "inappropriate for some users"),
        "youtube_age_restricted",
        "El video tiene restricción de edad y requiere autenticación.",
    ),
    (
        ("sign in to confirm you're not a bot", "confirm you're not a bot", "not a bot"),
        "youtube_bot_check",
        "YouTube pide verificar que no eres un bot. Intenta más tarde.",
    ),
    (
        ("this live event will begin", "premieres in", "not yet available"),
        "youtube_live_upcoming",
        "La transmisión aún no ha comenzado.",
    ),
    (
        ("is live", "live stream", "currently live"),
        "youtube_live_active",
        "Es una transmisión en vivo activa. Espera a que finalice para importarla.",
    ),
    (
        ("who has blocked it in your country", "not available in your country", "geo"),
        "youtube_geo_blocked",
        "El video tiene restricciones geográficas y no está disponible en tu región.",
    ),
    (
        ("sign in", "login required", "account", "cookies"),
        "youtube_auth_required",
        "El video requiere autenticación, que no está disponible en esta versión.",
    ),
    (
        ("requested format is not available", "no video formats found", "format is not available"),
        "youtube_format_unavailable",
        "No hay un formato descargable compatible para este video.",
    ),
    (
        ("ffmpeg", "ffprobe"),
        "youtube_ffmpeg_missing",
        "Falta FFmpeg/FFprobe para fusionar o validar el video.",
    ),
    (
        ("no space left", "not enough space", "disk full"),
        "youtube_no_space",
        "No hay espacio en disco suficiente para completar la descarga.",
    ),
    (
        ("unable to download", "network", "timed out", "connection", "http error 5"),
        "youtube_network",
        "Hubo un problema de red durante la descarga. Vuelve a intentarlo.",
    ),
    (
        ("out of date", "update to the current version", "yt-dlp is out of date"),
        "youtube_outdated",
        "yt-dlp está desactualizado. Actualízalo e inténtalo de nuevo.",
    ),
)

_GENERIC = YouTubeError(
    code="youtube_download_failed",
    message="No se pudo importar el video de YouTube. Revisa la URL e inténtalo de nuevo.",
)


def classify_error(stderr_tail: str) -> YouTubeError:
    """Map a stderr tail to a stable, user-safe ``YouTubeError``."""
    text = (stderr_tail or "").lower()
    for needles, code, message in _PATTERNS:
        if any(needle in text for needle in needles):
            return YouTubeError(code=code, message=message)
    return _GENERIC
