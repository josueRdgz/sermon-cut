"""Frame extract lock must not pass timeout=None (Python 3.13+ TypeError)."""

from __future__ import annotations

from pathlib import Path

from app.services.tracking.sample import extract_still


def test_extract_still_blocking_acquire_does_not_use_none_timeout(tmp_path: Path) -> None:
    output = tmp_path / "frame.jpg"

    def runner(args: list[str]) -> None:
        Path(args[-1]).write_bytes(b"jpeg")

    extract_still(
        Path("missing.mp4"),
        at_seconds=0,
        output=output,
        ffmpeg="ffmpeg",
        runner=runner,
        wait=True,
    )
    assert output.is_file()
