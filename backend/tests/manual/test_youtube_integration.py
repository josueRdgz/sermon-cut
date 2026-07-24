"""Optional, opt-in manual integration test for the YouTube importer.

This test performs a REAL yt-dlp metadata extraction (and, optionally, a real
download) and is therefore EXCLUDED from CI. It only runs when you point it at a
video *you own or are authorized to use*:

    SERMON_CUT_YT_TEST_URL="https://www.youtube.com/watch?v=..." \\
        pytest backend/tests/manual/test_youtube_integration.py -v

Set SERMON_CUT_YT_TEST_DOWNLOAD=1 to also exercise the full download+probe path
(slower, uses bandwidth and disk). Requires yt-dlp and FFmpeg installed.
"""

from __future__ import annotations

import os

import pytest

_URL = os.environ.get("SERMON_CUT_YT_TEST_URL", "").strip()

pytestmark = pytest.mark.skipif(
    not _URL,
    reason="Set SERMON_CUT_YT_TEST_URL to a video you are authorized to use.",
)


def test_real_preview() -> None:
    from app.services.youtube.manager import fetch_preview

    preview = fetch_preview(_URL)
    assert preview.video_id
    print(f"\nTitle:   {preview.title}")
    print(f"Channel: {preview.channel}")
    print(f"Length:  {preview.duration_seconds}s")
    print(f"Res:     {preview.resolution_label}")


@pytest.mark.skipif(
    os.environ.get("SERMON_CUT_YT_TEST_DOWNLOAD", "") != "1",
    reason="Set SERMON_CUT_YT_TEST_DOWNLOAD=1 to run the full download path.",
)
def test_real_download(tmp_path) -> None:  # noqa: ANN001 — pytest tmp_path fixture
    import shutil

    from app.core.config import get_settings
    from app.services.youtube.format_selection import build_format_selector
    from app.services.youtube.validation import validate_youtube_url
    from app.services.youtube.ytdlp import require_ytdlp, run_download

    exe = require_ytdlp(get_settings())
    assert shutil.which("ffmpeg"), "FFmpeg is required for merging."

    validated = validate_youtube_url(_URL)
    template = str(tmp_path / f"youtube-{validated.video_id}.%(ext)s")
    result = run_download(
        exe,
        validated.canonical_url,
        format_selector=build_format_selector("720p"),
        output_template=template,
        log_path=tmp_path / "yt.log",
    )
    assert result.returncode == 0, result.stderr_tail
    outputs = list(tmp_path.glob(f"youtube-{validated.video_id}.*"))
    assert any(p.suffix == ".mp4" for p in outputs), outputs
