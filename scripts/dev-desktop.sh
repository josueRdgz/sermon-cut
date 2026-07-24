#!/usr/bin/env bash
# Launch Sermon Cut as a desktop app (Tauri 2 + local FastAPI on 127.0.0.1).
# Keeps the normal two-terminal browser workflow untouched — use this only for
# the desktop shell.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT/frontend"

if [[ ! -x "$ROOT/backend/.venv/bin/python" ]]; then
  echo "Missing backend/.venv — run ./scripts/setup-macos.sh (or setup-linux.sh) first." >&2
  exit 1
fi

if ! command -v cargo >/dev/null 2>&1; then
  echo "Rust/cargo not found. Install from https://rustup.rs then re-run." >&2
  exit 1
fi

if ! command -v ffmpeg >/dev/null 2>&1; then
  echo "Warning: ffmpeg not on PATH. Install system FFmpeg before rendering." >&2
fi

exec npm run desktop:dev
