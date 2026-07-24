"""Optional YouTube import via yt-dlp.

Local file upload remains the primary, stable path. This package only adds an
opt-in way to fetch a single public/unlisted video into a project's storage and
then hand it to the existing SermonCut pipeline. No scraping is implemented: all
network access goes through the external ``yt-dlp`` executable with an explicit
argument list and ``shell=False``.
"""

from __future__ import annotations

from app.services.youtube.validation import (
    ValidatedYouTubeUrl,
    YouTubeUrlError,
    validate_youtube_url,
)

__all__ = [
    "ValidatedYouTubeUrl",
    "YouTubeUrlError",
    "validate_youtube_url",
]
