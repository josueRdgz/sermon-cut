#!/usr/bin/env bash
# Regenerate the tiny CC0 demo clip with FFmpeg (no third-party media).
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OUT="${SCRIPT_DIR}/media/sample-clip.mp4"
mkdir -p "${SCRIPT_DIR}/media"
ffmpeg -y \
  -f lavfi -i "color=c=0x1a365d:s=1280x720:d=4" \
  -f lavfi -i "sine=frequency=440:duration=4" \
  -c:v libx264 -pix_fmt yuv420p -c:a aac -shortest \
  "${OUT}"
echo "Wrote ${OUT}"
