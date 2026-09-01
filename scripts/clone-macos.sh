#!/usr/bin/env bash
# Clone Sermon Cut (if needed) and run the macOS setup script.
#
# From a terminal on the Mac:
#   git clone https://github.com/josueRdgz/sermon-cut.git
#   cd sermon-cut
#   ./scripts/clone-macos.sh
#
# Or as a one-liner (clones into ~/sermon-cut by default):
#   bash -c "$(curl -fsSL https://raw.githubusercontent.com/josueRdgz/sermon-cut/main/scripts/clone-macos.sh)"
#
# Extra flags are forwarded to setup-macos.sh, e.g.:
#   ./scripts/clone-macos.sh --with-desktop
#   ./scripts/clone-macos.sh --dir ~/src/sermon-cut --with-extras
set -euo pipefail

RED=$'\033[31m'
GREEN=$'\033[32m'
YELLOW=$'\033[33m'
RESET=$'\033[0m'

REPO_URL="${SERMON_CUT_REPO_URL:-https://github.com/josueRdgz/sermon-cut.git}"
DEST="${SERMON_CUT_DIR:-${HOME}/sermon-cut}"
SETUP_ARGS=()

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

usage() {
  cat <<'EOF'
Uso: ./scripts/clone-macos.sh [opciones] [-- flags-de-setup]

Clona github.com/josueRdgz/sermon-cut (si hace falta) y ejecuta setup-macos.sh.

Opciones de este script:
  --dir PATH     Destino del clon (default: ~/sermon-cut)
  --repo URL     URL git alternativa
  -h, --help     Muestra esta ayuda

Cualquier otra opción se pasa a setup-macos.sh (por ejemplo --with-desktop).

Si ya estás dentro de un clon del repo, no vuelve a clonar: solo prepara.
EOF
}

is_checkout() {
  local root="$1"
  [[ -f "${root}/scripts/setup-macos.sh" && -f "${root}/backend/pyproject.toml" ]]
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --dir)
      [[ $# -ge 2 ]] || fail "--dir requiere una ruta"
      DEST="$2"
      shift 2
      ;;
    --repo)
      [[ $# -ge 2 ]] || fail "--repo requiere una URL"
      REPO_URL="$2"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      SETUP_ARGS+=("$1")
      shift
      ;;
  esac
done

[[ "$(uname -s)" == "Darwin" ]] \
  || fail "Este script es solo para macOS. En Linux: git clone ${REPO_URL} && ./scripts/setup-linux.sh"

command -v git >/dev/null 2>&1 \
  || fail "No se encontró git. Instala Xcode Command Line Tools: xcode-select --install"

# Prefer the directory this file lives in when executed from a checkout.
SELF_ROOT=""
if [[ -n "${BASH_SOURCE[0]:-}" && -f "${BASH_SOURCE[0]}" ]]; then
  SELF_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  CANDIDATE="$(cd "${SELF_DIR}/.." && pwd)"
  if is_checkout "${CANDIDATE}"; then
    SELF_ROOT="${CANDIDATE}"
  fi
fi

if [[ -n "${SELF_ROOT}" ]]; then
  ROOT="${SELF_ROOT}"
  ok "Usando el clon existente: ${ROOT}"
elif is_checkout "${PWD}"; then
  ROOT="${PWD}"
  ok "Usando el clon del directorio actual: ${ROOT}"
else
  if [[ -d "${DEST}/.git" ]] && is_checkout "${DEST}"; then
    ROOT="$(cd "${DEST}" && pwd)"
    ok "Ya existe un clon en ${ROOT}"
    echo "==> git pull --ff-only"
    if ! git -C "${ROOT}" pull --ff-only; then
      warn "No se pudo hacer fast-forward. Continúo con el árbol local."
    fi
  elif [[ -e "${DEST}" ]]; then
    fail "«${DEST}» existe y no parece un clon de Sermon Cut. Elige otra ruta con --dir."
  else
    echo "==> git clone ${REPO_URL} → ${DEST}"
    git clone "${REPO_URL}" "${DEST}"
    ROOT="$(cd "${DEST}" && pwd)"
    ok "Clonado en ${ROOT}"
  fi
fi

chmod +x "${ROOT}/scripts/setup-macos.sh" "${ROOT}/scripts/clone-macos.sh"
exec "${ROOT}/scripts/setup-macos.sh" "${SETUP_ARGS[@]+"${SETUP_ARGS[@]}"}"
