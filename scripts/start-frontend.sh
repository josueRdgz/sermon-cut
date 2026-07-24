#!/usr/bin/env bash
# Start the Sermon Cut frontend (Vite). Works on macOS and Linux.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FRONTEND_DIR="$(cd "${SCRIPT_DIR}/../frontend" && pwd)"

cd "${FRONTEND_DIR}"

if [ ! -d "node_modules" ]; then
  echo "Instalando dependencias del frontend…"
  npm install
fi

echo "Iniciando Vite en http://localhost:5173 …"
exec npm run dev
