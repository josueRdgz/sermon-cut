"""URL validation + SSRF guard for the YouTube importer (no network)."""

from __future__ import annotations

import pytest
from app.services.youtube.validation import (
    YouTubeUrlError,
    validate_youtube_url,
)


@pytest.mark.parametrize(
    ("url", "expected_id"),
    [
        ("https://www.youtube.com/watch?v=dQw4w9WgXcQ", "dQw4w9WgXcQ"),
        ("https://youtube.com/watch?v=dQw4w9WgXcQ", "dQw4w9WgXcQ"),
        ("https://m.youtube.com/watch?v=dQw4w9WgXcQ", "dQw4w9WgXcQ"),
        ("https://youtu.be/dQw4w9WgXcQ", "dQw4w9WgXcQ"),
        ("https://www.youtube.com/shorts/dQw4w9WgXcQ", "dQw4w9WgXcQ"),
        ("https://www.youtube.com/live/dQw4w9WgXcQ", "dQw4w9WgXcQ"),
        ("https://www.youtube.com/embed/dQw4w9WgXcQ", "dQw4w9WgXcQ"),
    ],
)
def test_accepts_single_video_urls(url: str, expected_id: str) -> None:
    result = validate_youtube_url(url)
    assert result.video_id == expected_id
    assert result.canonical_url == f"https://www.youtube.com/watch?v={expected_id}"


def test_playlist_plus_video_imports_single_video() -> None:
    url = "https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=PL123456789"
    result = validate_youtube_url(url)
    assert result.video_id == "dQw4w9WgXcQ"
    assert result.had_playlist is True
    # Canonical URL never carries the playlist; download adds --no-playlist.
    assert "list=" not in result.canonical_url


@pytest.mark.parametrize(
    ("url", "code"),
    [
        ("https://www.youtube.com/playlist?list=PL123", "youtube_playlist"),
        ("https://www.youtube.com/watch?list=PL123", "youtube_playlist"),
        ("https://www.youtube.com/@somechannel", "youtube_channel"),
        ("https://www.youtube.com/channel/UC12345", "youtube_channel"),
        ("https://www.youtube.com/c/SomeChannel", "youtube_channel"),
        ("https://www.youtube.com/user/SomeUser", "youtube_channel"),
        ("https://www.youtube.com/results?search_query=sermon", "youtube_search"),
        ("https://vimeo.com/12345", "youtube_not_youtube"),
        ("https://example.com/watch?v=dQw4w9WgXcQ", "youtube_not_youtube"),
        ("file:///etc/passwd", "youtube_bad_scheme"),
        ("http://127.0.0.1/watch?v=dQw4w9WgXcQ", "youtube_not_youtube"),
        ("http://localhost/watch?v=dQw4w9WgXcQ", "youtube_not_youtube"),
        ("https://www.youtube.com/watch?v=short", "youtube_bad_video_id"),
        ("", "youtube_empty_url"),
    ],
)
def test_rejects_invalid_urls(url: str, code: str) -> None:
    with pytest.raises(YouTubeUrlError) as excinfo:
        validate_youtube_url(url)
    assert excinfo.value.code == code
