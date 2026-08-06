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

"$ROOT/scripts/build-backend-sidecar.sh"

# Persist Gemini settings into Application Support before packaging so the
# installed app keeps the key across DMG rebuilds. Never embeds secrets in the
# .app / DMG bundle itself.
if [[ -x "$ROOT/scripts/seed-desktop-env.sh" ]]; then
  "$ROOT/scripts/seed-desktop-env.sh"
elif [[ -f "$ROOT/scripts/seed-desktop-env.sh" ]]; then
  bash "$ROOT/scripts/seed-desktop-env.sh"
fi

BUNDLE_DIR="$ROOT/frontend/src-tauri/target/release/bundle"

if [[ "$(uname -s)" == "Darwin" ]]; then
  # Only produce the DMG installer. A leftover .app next to it (or iCloud
  # "Sermon Cut 2.app" copies) shows up as duplicate apps in Launchpad/Open.
  npm run desktop:build -- --bundles dmg
  # Tauri's DMG step already removes the temporary .app; sweep any leftovers /
  # iCloud conflict copies just in case.
  if [[ -d "$BUNDLE_DIR/macos" ]]; then
    find "$BUNDLE_DIR/macos" -maxdepth 1 -name '*.app' -exec rm -rf {} +
  fi
  if [[ -d "$BUNDLE_DIR/dmg" ]]; then
    find "$BUNDLE_DIR/dmg" -maxdepth 1 \( -name '* [0-9].dmg' -o -name '* [0-9].icns' -o -name '* [0-9].sh' \) -delete
  fi
else
  npm run desktop:build
fi
echo
echo "Artifacts under: frontend/src-tauri/target/release/bundle/"
echo "Install from the DMG only — no standalone .app is kept in the repo tree."
echo "The packaged app contains Python/FastAPI. FFmpeg and FFprobe remain system dependencies."
