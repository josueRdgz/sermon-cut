#!/usr/bin/env bash
# Start the Sermon Cut backend (FastAPI) on macOS.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$(cd "${SCRIPT_DIR}/../backend" && pwd)"
VENV_DIR="${BACKEND_DIR}/.venv"

cd "${BACKEND_DIR}"

if [ ! -d "${VENV_DIR}" ]; then
  echo "Creating virtual environment..."
  python3 -m venv "${VENV_DIR}"
fi

# shellcheck disable=SC1091
source "${VENV_DIR}/bin/activate"

echo "Installing backend dependencies..."
pip install --upgrade pip >/dev/null
pip install -e ".[dev]"

echo "Starting FastAPI on http://127.0.0.1:8000 ..."
exec uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
