#!/usr/bin/env bash
# Freeze FastAPI and its Python runtime for inclusion in the native app.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PYTHON="$ROOT/backend/.venv/bin/python"

if [[ ! -x "$PYTHON" ]]; then
  echo "Missing backend/.venv — run ./scripts/setup-macos.sh first." >&2
  exit 1
fi

if ! "$PYTHON" -m PyInstaller --version >/dev/null 2>&1; then
  echo "PyInstaller is missing in backend/.venv." >&2
  echo "Install it with: backend/.venv/bin/python -m pip install 'pyinstaller>=6.16'" >&2
  exit 1
fi

cd "$ROOT/backend"
export PYINSTALLER_CONFIG_DIR="$ROOT/backend/.pyinstaller-cache"
"$PYTHON" -m PyInstaller --noconfirm --clean sermon_cut_backend.spec

SIDECAR="$ROOT/backend/dist/sermon-cut-backend/sermon-cut-backend"
if [[ ! -x "$SIDECAR" ]]; then
  echo "Sidecar build did not produce $SIDECAR" >&2
  exit 1
fi

YTDLP="$ROOT/backend/dist/sermon-cut-backend/yt-dlp"
cp "$SIDECAR" "$YTDLP"
chmod +x "$YTDLP"
if ! "$YTDLP" --version >/dev/null 2>&1; then
  echo "Bundled yt-dlp self-check failed: $YTDLP" >&2
  exit 1
fi

echo "Backend sidecar ready: $SIDECAR"
echo "Bundled yt-dlp ready: $YTDLP"
