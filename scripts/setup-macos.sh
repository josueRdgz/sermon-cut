#!/usr/bin/env bash
# Sermon Cut — one-shot macOS setup (no Docker).
#
# Installs missing Homebrew packages, creates the Python 3.12 venv, installs
# npm deps, and runs doctor. Optional flags prepare a desktop (Tauri) install.
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

WITH_WHISPER=0
WITH_GEMINI=0
WITH_TRACKING=0
WITH_DESKTOP=0
SKIP_BREW=0

usage() {
  cat <<'EOF'
Uso: ./scripts/setup-macos.sh [opciones]

Prepara este clon de Sermon Cut para usarlo en macOS.

Opciones:
  --with-whisper    Instala faster-whisper (transcripción local)
  --with-gemini     Instala el SDK de Gemini (análisis editorial opcional)
  --with-tracking   Instala OpenCV (encuadre vertical opcional)
  --with-extras     Equivale a --with-whisper --with-gemini --with-tracking
  --with-desktop    Extras + Rust/cargo + Xcode CLT (para generar el .dmg)
  --skip-brew       No instala fórmulas con Homebrew (ya tienes las deps)
  -h, --help        Muestra esta ayuda

Después del setup (navegador):
  ./scripts/start-backend.sh
  ./scripts/start-frontend.sh

Después de --with-desktop (app nativa):
  ./scripts/build-desktop.sh
EOF
}

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

have_cmd() {
  command -v "$1" >/dev/null 2>&1
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --with-whisper) WITH_WHISPER=1 ;;
    --with-gemini) WITH_GEMINI=1 ;;
    --with-tracking) WITH_TRACKING=1 ;;
    --with-extras)
      WITH_WHISPER=1
      WITH_GEMINI=1
      WITH_TRACKING=1
      ;;
    --with-desktop)
      WITH_DESKTOP=1
      WITH_WHISPER=1
      WITH_GEMINI=1
      WITH_TRACKING=1
      ;;
    --skip-brew) SKIP_BREW=1 ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      fail "Opción desconocida: $1 (usa --help)"
      ;;
  esac
  shift
done

[[ "$(uname -s)" == "Darwin" ]] \
  || fail "Este script es solo para macOS. En Linux usa ./scripts/setup-linux.sh"

echo "==> Sermon Cut — setup macOS"
echo "    Repo: ${ROOT_DIR}"

# Homebrew (and several Python wheels) need the Command Line Tools.
if have_cmd xcode-select; then
  if xcode-select -p >/dev/null 2>&1; then
    ok "Xcode Command Line Tools: $(xcode-select -p)"
  else
    warn "No hay Xcode Command Line Tools. Se abrirá el instalador de macOS."
    xcode-select --install 2>/dev/null || true
    fail "Termina la instalación de Command Line Tools y vuelve a ejecutar este script."
  fi
fi

load_brew_env() {
  if [[ -x /opt/homebrew/bin/brew ]]; then
    # shellcheck disable=SC1091
    eval "$(/opt/homebrew/bin/brew shellenv)"
  elif [[ -x /usr/local/bin/brew ]]; then
    # shellcheck disable=SC1091
    eval "$(/usr/local/bin/brew shellenv)"
  fi
}

ensure_homebrew() {
  load_brew_env
  if have_cmd brew; then
    ok "Homebrew $(brew --version | head -n1)"
    return
  fi
  echo "==> Instalando Homebrew"
  NONINTERACTIVE=1 /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
  load_brew_env
  have_cmd brew || fail "Homebrew se instaló pero no está en PATH. Abre una terminal nueva y reintenta."
  ok "Homebrew $(brew --version | head -n1)"
}

brew_install_formula() {
  local formula="$1"
  if brew list --formula --versions "${formula}" >/dev/null 2>&1; then
    ok "brew: ${formula} ya está instalado"
    return
  fi
  echo "==> brew install ${formula}"
  brew install "${formula}"
  ok "brew: ${formula} instalado"
}

if [[ "${SKIP_BREW}" -eq 0 ]]; then
  ensure_homebrew
  brew_install_formula python@3.12
  brew_install_formula node
  brew_install_formula ffmpeg
else
  load_brew_env
  warn "Omitiendo Homebrew (--skip-brew)"
fi

resolve_python() {
  local candidate
  local -a candidates=(
    python3.12
    /opt/homebrew/opt/python@3.12/bin/python3.12
    /opt/homebrew/opt/python@3.12/bin/python3
    /usr/local/opt/python@3.12/bin/python3.12
    /usr/local/opt/python@3.12/bin/python3
    python3
  )
  for candidate in "${candidates[@]}"; do
    if [[ "${candidate}" == */* ]]; then
      [[ -x "${candidate}" ]] || continue
    else
      have_cmd "${candidate}" || continue
      candidate="$(command -v "${candidate}")"
    fi
    if "${candidate}" -c 'import sys; raise SystemExit(0 if sys.version_info>=(3,12) else 1)' \
      2>/dev/null; then
      printf '%s\n' "${candidate}"
      return 0
    fi
  done
  return 1
}

PYTHON_BIN="$(resolve_python)" \
  || fail "No hay Python ≥ 3.12. Instálalo con: brew install python@3.12"

have_cmd node || fail "No se encontró Node.js. Instálalo con: brew install node"
have_cmd npm || fail "No se encontró npm. Reinstala Node.js: brew install node"
have_cmd ffmpeg || fail "No se encontró FFmpeg. Instálalo con: brew install ffmpeg"
have_cmd ffprobe || fail "No se encontró FFprobe. Reinstala FFmpeg: brew install ffmpeg"

NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
[[ "${NODE_MAJOR}" -ge 18 ]] \
  || fail "Se requiere Node.js 18+ (encontrado $(node -v)). brew install node"

ok "Python $("${PYTHON_BIN}" --version 2>&1) (${PYTHON_BIN})"
ok "Node $(node -v) / npm $(npm -v)"
ok "FFmpeg $(ffmpeg -version 2>&1 | head -n1)"
ok "FFprobe $(ffprobe -version 2>&1 | head -n1)"

if ffmpeg -hide_banner -filters 2>/dev/null | awk '{print $2}' | grep -qx 'ass'; then
  ok "FFmpeg incluye el filtro ass (libass) para subtítulos quemados"
else
  warn "Este FFmpeg no anuncia el filtro ass. Los subtítulos quemados pueden fallar."
  warn "Prueba: brew install ffmpeg-full   (o define SERMON_CUT_FFMPEG_PATH)"
fi

if [[ "${ROOT_DIR}" == *"Mobile Documents"* || "${ROOT_DIR}" == *"iCloud"* ]]; then
  warn "Este clon está en iCloud Drive. SQLite y renders pueden corromperse."
  warn "Clona fuera de iCloud (p. ej. ${HOME}/sermon-cut) o define SERMON_CUT_STORAGE_DIR."
fi

if [[ ! -f "${ROOT_DIR}/.env" ]]; then
  cp "${ROOT_DIR}/.env.example" "${ROOT_DIR}/.env"
  ok "Creado .env desde .env.example"
else
  ok ".env ya existe (no se sobrescribe)"
fi

mkdir -p "${ROOT_DIR}/storage/projects" "${ROOT_DIR}/storage/temp" \
  "${ROOT_DIR}/storage/exports" "${ROOT_DIR}/storage/whisper-models"
ok "Carpetas de almacenamiento listas"

if [[ -x "${VENV_DIR}/bin/python" ]]; then
  if ! "${VENV_DIR}/bin/python" -c 'import sys; raise SystemExit(0 if sys.version_info>=(3,12) else 1)'; then
    warn "El .venv usa Python < 3.12. Se recreará con ${PYTHON_BIN}."
    rm -rf "${VENV_DIR}"
  fi
fi

echo "==> Backend (venv + pip)"
cd "${BACKEND_DIR}"
if [[ ! -d "${VENV_DIR}" ]]; then
  "${PYTHON_BIN}" -m venv "${VENV_DIR}"
fi
# shellcheck disable=SC1091
source "${VENV_DIR}/bin/activate"
python -m pip install --upgrade pip

PIP_EXTRAS="dev"
[[ "${WITH_WHISPER}" -eq 1 ]] && PIP_EXTRAS+=",whisper"
[[ "${WITH_GEMINI}" -eq 1 ]] && PIP_EXTRAS+=",gemini"
[[ "${WITH_TRACKING}" -eq 1 ]] && PIP_EXTRAS+=",tracking"
pip install -e ".[${PIP_EXTRAS}]"
ok "Dependencias backend instaladas ([${PIP_EXTRAS}])"

echo "==> Migraciones"
if ! alembic upgrade head; then
  warn "Migración falló. Puedes reintentar con: cd backend && alembic upgrade head"
else
  ok "Migraciones aplicadas"
fi

echo "==> Frontend (npm)"
cd "${FRONTEND_DIR}"
npm install
ok "Dependencias frontend instaladas"

if [[ "${WITH_DESKTOP}" -eq 1 ]]; then
  echo "==> Herramientas de escritorio (Rust)"
  if have_cmd cargo && have_cmd rustc; then
    ok "Rust $(rustc --version) / $(cargo --version)"
  else
    echo "==> Instalando rustup (perfil minimal, -y)"
    curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --profile minimal
    # shellcheck disable=SC1091
    source "${HOME}/.cargo/env"
    have_cmd cargo || fail "rustup terminó pero cargo no está en PATH. Abre una terminal nueva y reintenta."
    ok "Rust $(rustc --version) / $(cargo --version)"
  fi
fi

echo "==> Diagnóstico"
cd "${BACKEND_DIR}"
# shellcheck disable=SC1091
source "${VENV_DIR}/bin/activate"
python -m app.cli doctor || warn "El diagnóstico reportó problemas (revisa arriba)."

echo ""
echo "${GREEN}Setup macOS completado.${RESET}"
echo "  Navegador — terminal 1: ./scripts/start-backend.sh"
echo "  Navegador — terminal 2: ./scripts/start-frontend.sh"
echo "  Abre: http://localhost:5173"
if [[ "${WITH_DESKTOP}" -eq 1 ]]; then
  echo "  App nativa (genera el .dmg): ./scripts/build-desktop.sh"
  echo "  Instala el .dmg desde frontend/src-tauri/target/release/bundle/dmg/"
else
  echo "  Para preparar la app de escritorio: ./scripts/setup-macos.sh --with-desktop"
fi
echo "  Demo: ver carpeta demo/"
