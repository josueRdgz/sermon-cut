#!/usr/bin/env bash
# Sermon Cut / Sermon Clips — reproducible setup for Linux (no Docker).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
BACKEND_DIR="${ROOT_DIR}/backend"
FRONTEND_DIR="${ROOT_DIR}/frontend"
VENV_DIR="${BACKEND_DIR}/.venv"

RED=$'\033[31m'
GREEN=$'\033[32m'
YELLOW=$'\033[33m'
RESET=$'\033[0m'

fail() {
  echo "${RED}ERROR:${RESET} $*" >&2
  exit 1
}

warn() {
  echo "${YELLOW}AVISO:${RESET} $*" >&2
}

ok() {
  echo "${GREEN}OK:${RESET} $*"
}

need_cmd() {
  local name="$1"
  local hint="$2"
  if ! command -v "${name}" >/dev/null 2>&1; then
    fail "No se encontró «${name}» en el PATH. ${hint}"
  fi
}

echo "==> Sermon Cut — setup Linux"
echo "    Repo: ${ROOT_DIR}"

need_cmd python3 "Debian/Ubuntu: sudo apt install python3 python3-venv python3-pip — Fedora: sudo dnf install python3"
need_cmd node "Instala Node.js 18+ (NodeSource, nvm, o el paquete de tu distro)."
need_cmd npm "Instala npm junto con Node.js."
need_cmd ffmpeg "Debian/Ubuntu: sudo apt install ffmpeg — Fedora: sudo dnf install ffmpeg"
need_cmd ffprobe "Forma parte del paquete ffmpeg."

python3 -c 'import sys; raise SystemExit(0 if sys.version_info>=(3,12) else 1)' \
  || fail "Se requiere Python ≥ 3.12. En Ubuntu 22.04+ usa deadsnakes o pyenv si hace falta."

ok "Python $(python3 --version 2>&1)"
ok "Node $(node -v) / npm $(npm -v)"
ok "FFmpeg $(ffmpeg -version 2>&1 | head -n1)"
ok "FFprobe $(ffprobe -version 2>&1 | head -n1)"

if [ ! -f "${ROOT_DIR}/.env" ]; then
  cp "${ROOT_DIR}/.env.example" "${ROOT_DIR}/.env"
  ok "Creado .env desde .env.example"
else
  ok ".env ya existe (no se sobrescribe)"
fi

mkdir -p "${ROOT_DIR}/storage/projects" "${ROOT_DIR}/storage/temp" \
  "${ROOT_DIR}/storage/exports" "${ROOT_DIR}/storage/whisper-models"
ok "Carpetas de almacenamiento listas"

echo "==> Backend (venv + pip)"
cd "${BACKEND_DIR}"
if [ ! -d "${VENV_DIR}" ]; then
  python3 -m venv "${VENV_DIR}"
fi
# shellcheck disable=SC1091
source "${VENV_DIR}/bin/activate"
python -m pip install --upgrade pip
pip install -e ".[dev]"
ok "Dependencias backend instaladas"

echo "==> Migraciones"
if ! alembic upgrade head; then
  warn "Migración falló. Reintenta: cd backend && source .venv/bin/activate && alembic upgrade head"
else
  ok "Migraciones aplicadas"
fi

echo "==> Frontend (npm)"
cd "${FRONTEND_DIR}"
npm install
ok "Dependencias frontend instaladas"

echo "==> Diagnóstico"
cd "${BACKEND_DIR}"
# shellcheck disable=SC1091
source "${VENV_DIR}/bin/activate"
python -m app.cli doctor || warn "El diagnóstico reportó problemas (revisa arriba)."

echo ""
echo "${GREEN}Setup Linux completado.${RESET}"
echo "  Terminal 1: ./scripts/start-backend.sh"
echo "  Terminal 2: ./scripts/start-frontend.sh"
echo "  Abre: http://localhost:5173"
