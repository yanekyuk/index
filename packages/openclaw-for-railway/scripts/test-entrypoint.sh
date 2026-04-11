#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
ENTRYPOINT="$REPO_ROOT/entrypoint.sh"

if [ ! -f "$ENTRYPOINT" ]; then
  echo "FAIL: $ENTRYPOINT does not exist"
  exit 1
fi

# Static analysis: shellcheck
if command -v shellcheck >/dev/null 2>&1; then
  shellcheck --shell=sh "$ENTRYPOINT" || { echo "FAIL: shellcheck reported issues"; exit 1; }
else
  echo "WARN: shellcheck not installed, skipping static analysis"
fi

if ! command -v envsubst >/dev/null 2>&1; then
  echo "FAIL: envsubst not installed"
  exit 1
fi

TMPROOT="$(mktemp -d)"
trap 'rm -rf "$TMPROOT"' EXIT

# Mock openclaw binary: writes its argv to a log file and exits 0.
MOCK_BIN="$TMPROOT/bin"
mkdir -p "$MOCK_BIN"
cat > "$MOCK_BIN/openclaw" <<'MOCK'
#!/bin/sh
echo "$@" >> "$MOCK_CALL_LOG"
exit 0
MOCK
chmod +x "$MOCK_BIN/openclaw"

cat > "$MOCK_BIN/node" <<'MOCK'
#!/bin/sh
echo "node $*" >> "$NODE_CALL_LOG"
exit 0
MOCK
chmod +x "$MOCK_BIN/node"

# Fake the opt install layout the entrypoint expects.
mkdir -p "$TMPROOT/opt/openclaw-railway"
cp "$REPO_ROOT/config.json5.template" "$TMPROOT/opt/openclaw-railway/config.json5.template"

export MOCK_CALL_LOG="$TMPROOT/openclaw-calls.log"
export NODE_CALL_LOG="$TMPROOT/node-calls.log"
: > "$MOCK_CALL_LOG"
: > "$NODE_CALL_LOG"

# Run the entrypoint with the mock PATH and a tmp XDG dir.
export XDG_CONFIG_HOME="$TMPROOT/xdg/.openclaw"
export PORT=18789
export OPENCLAW_PROVIDER="openai"
export OPENAI_API_KEY="sk-test-DUMMY"
export OPENCLAW_GATEWAY_TOKEN="test-gateway-token"
export OPENCLAW_HOOKS_TOKEN="test-hooks-token"
export RAILWAY_PUBLIC_DOMAIN="example.up.railway.app"

# Rebind HOME to a tmp dir so the entrypoint's `export HOME=/data` doesn't try
# to mkdir /data on the test host (which would fail without root).
export OPENCLAW_HOME_DIR="$TMPROOT/home"

# Rebind the template install path via env var so the entrypoint reads the tmp copy.
export OPENCLAW_RAILWAY_TEMPLATE_DIR="$TMPROOT/opt/openclaw-railway"

PATH="$MOCK_BIN:$PATH" sh "$ENTRYPOINT"

# Assertion 1: onboarding ran once
grep -q 'onboard --non-interactive' "$MOCK_CALL_LOG" || { echo "FAIL: openclaw onboard not invoked"; cat "$MOCK_CALL_LOG"; exit 1; }
grep -q 'openai-api-key' "$MOCK_CALL_LOG" || { echo "FAIL: openai-api-key auth-choice not passed"; exit 1; }

# Assertion 2: config.json5 was rendered
test -f "$XDG_CONFIG_HOME/config.json5" || { echo "FAIL: config.json5 not rendered"; exit 1; }
grep -q 'test-gateway-token' "$XDG_CONFIG_HOME/config.json5" || { echo "FAIL: gateway token missing from rendered config"; exit 1; }

# Assertion 3: marker file was created
test -f "$XDG_CONFIG_HOME/.railway-onboarded" || { echo "FAIL: marker file not created"; exit 1; }

# Assertion 4: node was invoked for the gateway
grep -q 'gateway --bind lan --port 18789' "$NODE_CALL_LOG" || { echo "FAIL: gateway not execed"; cat "$NODE_CALL_LOG"; exit 1; }

# --- second run: marker should suppress onboarding ---
: > "$MOCK_CALL_LOG"
: > "$NODE_CALL_LOG"
PATH="$MOCK_BIN:$PATH" sh "$ENTRYPOINT"

if grep -q 'onboard' "$MOCK_CALL_LOG"; then
  echo "FAIL: onboarding re-ran on second boot when marker exists"
  cat "$MOCK_CALL_LOG"
  exit 1
fi

# --- third run with OPENCLAW_REONBOARD=1: onboarding should re-run ---
: > "$MOCK_CALL_LOG"
: > "$NODE_CALL_LOG"
OPENCLAW_REONBOARD=1 PATH="$MOCK_BIN:$PATH" sh "$ENTRYPOINT"
grep -q 'onboard' "$MOCK_CALL_LOG" || { echo "FAIL: REONBOARD=1 did not force re-onboarding"; exit 1; }

echo "OK: entrypoint passes all assertions (onboard once, skip on marker, force with REONBOARD)"
