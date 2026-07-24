"""``python -m app.cli`` → delegates to ``app.cli`` package main."""

from __future__ import annotations

from app.cli import main

if __name__ == "__main__":
    raise SystemExit(main())
