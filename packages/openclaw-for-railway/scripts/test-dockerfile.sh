#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
DOCKERFILE="$REPO_ROOT/Dockerfile"

if [ ! -f "$DOCKERFILE" ]; then
  echo "FAIL: $DOCKERFILE does not exist"
  exit 1
fi

# Static analysis: hadolint
if command -v hadolint >/dev/null 2>&1; then
  # Ignore DL3008 (pin apt versions) since the base image controls package versions.
  hadolint --ignore DL3008 "$DOCKERFILE" || { echo "FAIL: hadolint reported issues"; exit 1; }
else
  echo "WARN: hadolint not installed, skipping static analysis"
fi

# Sanity-check the FROM line references the official image.
grep -qE '^FROM openclaw/openclaw(:[^ ]+)?$' "$DOCKERFILE" || {
  echo "FAIL: Dockerfile must FROM openclaw/openclaw"
  exit 1
}

# Sanity-check the ENTRYPOINT line.
grep -q 'ENTRYPOINT.*entrypoint.sh' "$DOCKERFILE" || {
  echo "FAIL: Dockerfile must set ENTRYPOINT to entrypoint.sh"
  exit 1
}

echo "OK: Dockerfile static checks passed"
