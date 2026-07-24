#!/usr/bin/env bash
# Start the Sermon Cut frontend (Vite dev server) on macOS.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FRONTEND_DIR="$(cd "${SCRIPT_DIR}/../frontend" && pwd)"

cd "${FRONTEND_DIR}"

if [ ! -d "node_modules" ]; then
  echo "Installing frontend dependencies..."
  npm install
fi

echo "Starting Vite on http://localhost:5173 ..."
exec npm run dev
