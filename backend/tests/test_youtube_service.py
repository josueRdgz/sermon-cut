"""Pure-unit tests for YouTube service helpers (no subprocess, no network)."""

from __future__ import annotations

import sys
from pathlib import Path

import pytest
from app.core.config import Settings
from app.services.youtube.errors import classify_error
from app.services.youtube.format_selection import (
    build_format_selector,
    normalize_quality,
)
from app.services.youtube.metadata import (
    YouTubeMetadataError,
    assert_importable,
    parse_preview,
)
from app.services.youtube.ytdlp import _PROGRESS_PREFIX, _parse_progress_line, locate_ytdlp


def test_normalize_quality_falls_back() -> None:
    assert normalize_quality("720p") == "720p"
    assert normalize_quality("1080p") == "1080p"
    assert normalize_quality("best") == "best"
    assert normalize_quality("4k") == "1080p"
    assert normalize_quality(None) == "1080p"


def test_format_selector_caps_height_and_has_fallback() -> None:
    selector = build_format_selector("720p")
    assert "height<=720" in selector
    assert selector.endswith("b/best")
    assert "avc1" in selector  # prefers H.264

    best = build_format_selector("best")
    assert "height<=" not in best
    assert best.endswith("b/best")


@pytest.mark.parametrize(
    ("stderr", "code"),
    [
        ("ERROR: Private video. Sign in if you've been granted access", "youtube_private"),
        ("ERROR: Video unavailable", "youtube_unavailable"),
        ("ERROR: Sign in to confirm your age", "youtube_age_restricted"),
        ("ERROR: Sign in to confirm you're not a bot", "youtube_bot_check"),
        ("ERROR: This live event will begin in 2 hours", "youtube_live_upcoming"),
        ("ERROR: … is not available in your country", "youtube_geo_blocked"),
        ("ERROR: Requested format is not available", "youtube_format_unavailable"),
        ("ERROR: ffmpeg not found", "youtube_ffmpeg_missing"),
        ("ERROR: No space left on device", "youtube_no_space"),
        ("ERROR: yt-dlp is out of date, update to the current version", "youtube_outdated"),
        ("some totally unexpected message", "youtube_download_failed"),
    ],
)
def test_classify_error(stderr: str, code: str) -> None:
    assert classify_error(stderr).code == code


def test_classify_error_never_leaks_raw_text() -> None:
    err = classify_error("ERROR: /Users/secret/path private video cookies from browser")
    assert "/Users/secret" not in err.message
    assert err.code == "youtube_private"


def _base_payload() -> dict:
    return {
        "id": "dQw4w9WgXcQ",
        "title": "Sermón de prueba",
        "channel": "Iglesia Demo",
        "duration": 1800,
        "thumbnail": "https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg",
        "upload_date": "20240115",
        "formats": [
            {"vcodec": "avc1.640028", "acodec": "none", "height": 1080, "filesize": 100},
            {"vcodec": "none", "acodec": "mp4a.40.2", "filesize": 20},
        ],
    }


def test_parse_preview_extracts_safe_subset() -> None:
    preview = parse_preview(_base_payload())
    assert preview.video_id == "dQw4w9WgXcQ"
    assert preview.title == "Sermón de prueba"
    assert preview.channel == "Iglesia Demo"
    assert preview.duration_seconds == 1800
    assert preview.resolution_label == "1080p"
    assert preview.upload_date == "2024-01-15"
    assert preview.thumbnail_url.startswith("https://")


def test_assert_importable_accepts_finished_video() -> None:
    payload = _base_payload()
    preview = parse_preview(payload)
    assert_importable(preview, payload, max_duration_seconds=4 * 3600)


def test_assert_importable_rejects_active_live() -> None:
    payload = _base_payload()
    payload["is_live"] = True
    payload["live_status"] = "is_live"
    preview = parse_preview(payload)
    with pytest.raises(YouTubeMetadataError) as exc:
        assert_importable(preview, payload, max_duration_seconds=4 * 3600)
    assert exc.value.code == "youtube_live_active"


def test_assert_importable_rejects_upcoming_live() -> None:
    payload = _base_payload()
    payload["live_status"] = "is_upcoming"
    preview = parse_preview(payload)
    with pytest.raises(YouTubeMetadataError) as exc:
        assert_importable(preview, payload, max_duration_seconds=4 * 3600)
    assert exc.value.code == "youtube_live_upcoming"


def test_assert_importable_rejects_no_video_streams() -> None:
    payload = _base_payload()
    payload["formats"] = [{"vcodec": "none", "acodec": "mp4a.40.2"}]
    preview = parse_preview(payload)
    with pytest.raises(YouTubeMetadataError) as exc:
        assert_importable(preview, payload, max_duration_seconds=4 * 3600)
    assert exc.value.code == "youtube_no_streams"


def test_assert_importable_rejects_too_long() -> None:
    payload = _base_payload()
    payload["duration"] = 10_000
    preview = parse_preview(payload)
    with pytest.raises(YouTubeMetadataError) as exc:
        assert_importable(preview, payload, max_duration_seconds=3600)
    assert exc.value.code == "youtube_too_long"


def test_parse_progress_line() -> None:
    line = f"{_PROGRESS_PREFIX}downloading\t500\t1000\tNA\t250000\t12"
    update = _parse_progress_line(line, "downloading_video")
    assert update is not None
    assert update.downloaded_bytes == 500
    assert update.total_bytes == 1000
    assert update.speed_bps == 250000
    assert update.eta_seconds == 12
    assert update.fraction == pytest.approx(0.5)


def test_parse_progress_line_handles_missing_fields() -> None:
    line = f"{_PROGRESS_PREFIX}downloading\tNA\tNA\tNA\tNA\tNA"
    update = _parse_progress_line(line, "downloading_video")
    assert update is not None
    assert update.downloaded_bytes is None
    assert update.total_bytes is None
    assert update.fraction is None


def test_locate_ytdlp_prefers_bundled_executable(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    backend = tmp_path / "sermon-cut-backend"
    backend.touch()
    bundled = tmp_path / ("yt-dlp.exe" if sys.platform == "win32" else "yt-dlp")
    bundled.touch()
    monkeypatch.setattr(sys, "frozen", True, raising=False)
    monkeypatch.setattr(sys, "executable", str(backend))
    monkeypatch.setattr("shutil.which", lambda _name: "/external/yt-dlp")

    assert locate_ytdlp(Settings()) == str(bundled)


def test_locate_ytdlp_override_still_has_priority(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    override = tmp_path / "custom-yt-dlp"
    override.touch()
    monkeypatch.setattr(sys, "frozen", True, raising=False)
    monkeypatch.setattr(sys, "executable", str(tmp_path / "sermon-cut-backend"))

    assert locate_ytdlp(Settings(ytdlp_path=str(override))) == str(override)
