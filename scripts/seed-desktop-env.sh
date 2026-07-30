#!/usr/bin/env bash
# Seed ~/Library/Application Support/app.sermoncut.desktop/.env from the repo
# .env when the persistent file is missing. Never prints secret values.
# Never overwrites an existing Application Support .env.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SOURCE="${SERMON_CUT_SOURCE_ENV:-$ROOT/.env}"
TARGET_DIR="${HOME}/Library/Application Support/app.sermoncut.desktop"
TARGET="$TARGET_DIR/.env"

if [[ -f "$TARGET" ]]; then
  echo "Desktop env already exists at Application Support (left unchanged)."
  exit 0
fi

if [[ ! -f "$SOURCE" ]]; then
  echo "No repo .env to migrate; packaged app will use mock until configured."
  exit 0
fi

# Extract only Gemini-related keys without echoing values.
AI_PROVIDER="$(grep -E '^[[:space:]]*SERMON_CUT_AI_PROVIDER=' "$SOURCE" | tail -n1 | sed 's/^[^=]*=//' | sed 's/^["'\'']//;s/["'\'']$//' || true)"
GEMINI_KEY="$(grep -E '^[[:space:]]*SERMON_CUT_GEMINI_API_KEY=' "$SOURCE" | tail -n1 | sed 's/^[^=]*=//' | sed 's/^["'\'']//;s/["'\'']$//' || true)"
GEMINI_MODEL="$(grep -E '^[[:space:]]*SERMON_CUT_GEMINI_MODEL=' "$SOURCE" | tail -n1 | sed 's/^[^=]*=//' | sed 's/^["'\'']//;s/["'\'']$//' || true)"

if [[ -z "${GEMINI_KEY// }" ]]; then
  echo "Repo .env has no SERMON_CUT_GEMINI_API_KEY; skipping desktop env seed."
  exit 0
fi

mkdir -p "$TARGET_DIR"
umask 077
{
  echo "# Sermon Cut desktop configuration (Application Support)"
  echo "# Seeded once from the development .env. Values are never logged."
  echo "SERMON_CUT_AI_PROVIDER=${AI_PROVIDER:-gemini}"
  # shellcheck disable=SC2016
  printf 'SERMON_CUT_GEMINI_API_KEY=%s\n' "$GEMINI_KEY"
  echo "SERMON_CUT_GEMINI_MODEL=${GEMINI_MODEL:-gemini-2.5-flash}"
} >"$TARGET"
chmod 600 "$TARGET"

# Confirm without revealing the key.
KEY_LEN="${#GEMINI_KEY}"
echo "Seeded desktop Gemini env (${KEY_LEN} char key) → Application Support (mode 0600)."
