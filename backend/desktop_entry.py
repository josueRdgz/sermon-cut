"""Frozen desktop entrypoint used by the Tauri macOS bundle."""

from __future__ import annotations

import argparse
import multiprocessing

import uvicorn
from app.main import app


def main() -> None:
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
