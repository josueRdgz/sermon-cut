"""Frozen desktop entrypoint used by the Tauri macOS bundle."""

from __future__ import annotations

import argparse
import multiprocessing
import sys
from pathlib import Path


def _running_as_ytdlp() -> bool:
    """The desktop build copies this executable as ``yt-dlp`` beside the API."""
    return Path(sys.argv[0]).stem == "yt-dlp"


def main() -> None:
    if _running_as_ytdlp():
        from yt_dlp import main as ytdlp_main

        raise SystemExit(ytdlp_main())

    # Keep backend imports lazy: the same frozen executable is copied as
    # ``yt-dlp`` and may be launched from a read-only mounted DMG.
    import uvicorn
    from app.main import app

    parser = argparse.ArgumentParser(description="Sermon Cut local API")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, required=True)
    args = parser.parse_args()
    uvicorn.run(
        app,
        host=args.host,
        port=args.port,
        log_level="info",
        access_log=False,
    )


if __name__ == "__main__":
    multiprocessing.freeze_support()
    main()
