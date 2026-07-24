#!/usr/bin/env bash
# Produce a local desktop build (does NOT publish GitHub releases).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT/frontend"

if [[ ! -x "$ROOT/backend/.venv/bin/python" ]]; then
  echo "Missing backend/.venv — run the platform setup script first." >&2
  exit 1
fi

if ! command -v cargo >/dev/null 2>&1; then
  echo "Rust/cargo not found. Install from https://rustup.rs then re-run." >&2
  exit 1
fi

npm run desktop:build
echo
echo "Artifacts under: frontend/src-tauri/target/release/bundle/"
echo "The app still expects backend/.venv (or SERMON_CUT_PYTHON) and system FFmpeg."
