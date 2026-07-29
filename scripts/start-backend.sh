#!/usr/bin/env bash
# Start the Sermon Cut backend (FastAPI). Works on macOS and Linux.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
BACKEND_DIR="${ROOT_DIR}/backend"
VENV_DIR="${BACKEND_DIR}/.venv"

cd "${BACKEND_DIR}"

if [ ! -d "${VENV_DIR}" ]; then
  echo "No hay entorno virtual. Ejecuta primero:"
  echo "  ./scripts/setup-macos.sh   # o setup-linux.sh"
  exit 1
fi

# shellcheck disable=SC1091
source "${VENV_DIR}/bin/activate"

# Prefer repo-root .env if present.
if [ -f "${ROOT_DIR}/.env" ]; then
  set -a
  # shellcheck disable=SC1091
  source "${ROOT_DIR}/.env"
  set +a
fi

echo "Aplicando migraciones (seguro ante fallos)…"
if ! python -m app.cli migrate; then
  echo "AVISO: migración falló; el servidor arrancará igual (auto_migrate en create_app)."
fi

UVICORN_ARGS=(app.main:app --host 127.0.0.1 --port 8000)
if [[ "${SERMON_CUT_RELOAD:-false}" == "true" ]]; then
  # Keep .venv outside the watcher. Installing faster-whisper while uvicorn
  # watches all of backend/ otherwise restarts active in-process jobs.
  UVICORN_ARGS+=(--reload --reload-dir app)
  echo "Iniciando FastAPI con autoreload limitado a backend/app/ …"
else
  echo "Iniciando FastAPI en http://127.0.0.1:8000 (sin autoreload) …"
fi
exec uvicorn "${UVICORN_ARGS[@]}"
