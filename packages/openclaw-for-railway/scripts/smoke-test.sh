#!/usr/bin/env bash
# Full integration smoke test: build the image, run it, verify the gateway
# starts listening and the rendered config reflects the supplied env vars.
#
# This test actually builds the Docker image and runs a container, so it
# requires Docker + network to pull the base image. Skip in sandboxed CI if
# Docker-in-Docker is unavailable; run locally or in GitHub Actions.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
IMAGE="openclaw-for-railway:smoke"
CONTAINER="openclaw-smoke-$$"

cleanup() {
  docker rm -f "$CONTAINER" >/dev/null 2>&1 || true
  rm -rf "$TMPDATA"
}
trap cleanup EXIT

TMPDATA="$(mktemp -d)"

echo "==> docker build"
docker build -t "$IMAGE" "$REPO_ROOT"

echo "==> docker run"
docker run -d --name "$CONTAINER" \
  -p 18789:18789 \
  -v "$TMPDATA:/data" \
  -e PORT=18789 \
  -e OPENCLAW_PROVIDER=openai \
  -e OPENAI_API_KEY=sk-test-DUMMY \
  -e OPENCLAW_GATEWAY_TOKEN=test-gateway-token-smoke \
  -e OPENCLAW_HOOKS_TOKEN=test-hooks-token-smoke \
  -e GOG_KEYRING_PASSWORD=test-keyring-password-smoke \
  -e RAILWAY_PUBLIC_DOMAIN=example.up.railway.app \
  -e XDG_CONFIG_HOME=/data/.openclaw \
  "$IMAGE"

# Wait up to 30s for the gateway to bind.
for i in $(seq 1 30); do
  if docker exec "$CONTAINER" sh -c 'ss -ltn 2>/dev/null | grep -q ":18789"' 2>/dev/null; then
    break
  fi
  sleep 1
done

# Assertion 1: rendered config exists in the volume
test -f "$TMPDATA/.openclaw/config.json5" || {
  echo "FAIL: config.json5 not rendered into volume"
  docker logs "$CONTAINER"
  exit 1
}

# Assertion 2: rendered config contains substituted values
grep -q 'test-gateway-token-smoke' "$TMPDATA/.openclaw/config.json5" || {
  echo "FAIL: gateway token not substituted"
  exit 1
}

# Assertion 3: marker file exists after onboarding
test -f "$TMPDATA/.openclaw/.railway-onboarded" || {
  echo "FAIL: onboarding marker not created"
  exit 1
}

# Assertion 4: gateway is actually listening
docker exec "$CONTAINER" sh -c 'ss -ltn 2>/dev/null | grep -q ":18789"' || {
  echo "FAIL: gateway not listening on 18789"
  docker logs "$CONTAINER" | tail -50
  exit 1
}

echo "==> second run with same volume (no re-onboard expected)"
docker rm -f "$CONTAINER" >/dev/null
docker run -d --name "$CONTAINER" \
  -p 18789:18789 \
  -v "$TMPDATA:/data" \
  -e PORT=18789 \
  -e OPENCLAW_PROVIDER=openai \
  -e OPENAI_API_KEY=sk-test-DUMMY \
  -e OPENCLAW_GATEWAY_TOKEN=test-gateway-token-smoke \
  -e OPENCLAW_HOOKS_TOKEN=test-hooks-token-smoke \
  -e GOG_KEYRING_PASSWORD=test-keyring-password-smoke \
  -e RAILWAY_PUBLIC_DOMAIN=example.up.railway.app \
  -e XDG_CONFIG_HOME=/data/.openclaw \
  "$IMAGE"

sleep 5
LOGS="$(docker logs "$CONTAINER" 2>&1)"
if echo "$LOGS" | grep -qi 'onboard'; then
  echo "FAIL: second run re-ran onboarding when marker exists"
  echo "$LOGS"
  exit 1
fi

echo "OK: smoke test passed (build, run, render, listen, skip-re-onboard)"
