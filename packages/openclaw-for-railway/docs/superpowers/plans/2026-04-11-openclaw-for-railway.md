# openclaw-for-railway Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a one-click Railway template that deploys a fully-featured OpenClaw gateway (Control UI, webhooks, plugins, tools, memory search) with Railway-generated secrets and a single user-supplied LLM provider key.

**Architecture:** Thin overlay on `openclaw/openclaw:latest`. An `entrypoint.sh` runs non-interactive `openclaw onboard` on first boot (idempotent via marker file), then `envsubst`-renders `config.json5.template` to `$XDG_CONFIG_HOME/config.json5` on every boot, then execs the gateway. Single Railway service, single volume mounted at `/data`, public domain.

**Tech Stack:** Docker (thin overlay on official image), POSIX sh, envsubst (`gettext-base`), JSON5, Railway config-as-code (`railway.toml` with `DOCKERFILE` builder), GitHub Actions CI (hadolint + shellcheck + docker smoke test).

**Spec reference:** `packages/openclaw-for-railway/docs/superpowers/specs/2026-04-11-openclaw-for-railway-design.md`

**Working directory scope:** All files live under `packages/openclaw-for-railway/`. Do NOT read or modify files outside this directory. A sibling `packages/openclaw-railway-template/` exists but is out of scope and must not be touched.

**Commits:** Use SSH signing (already configured globally). Use conventional commits. Pre-commit hooks may run `lint-staged`; if a hook reports no staged files matching tasks, that is fine and the commit still proceeds.

**Sandbox:** Git operations write to `/home/yanek/Projects/index/.git/` which is outside the sandbox write roots. Subagents MUST pass `dangerouslyDisableSandbox: true` for any `git add`, `git commit`, `git status`, or any bash command that triggers git. Build/test commands do not need the override.

---

## Task 1: Bootstrap repo skeleton

**Files:**
- Create: `packages/openclaw-for-railway/LICENSE`
- Create: `packages/openclaw-for-railway/.gitignore`

- [ ] **Step 1: Create LICENSE (MIT)**

```
MIT License

Copyright (c) 2026 Index Network

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

- [ ] **Step 2: Create .gitignore**

```
# OS
.DS_Store
Thumbs.db

# Env files
.env
.env.*
!.env.example

# Logs
*.log
npm-debug.log*
yarn-debug.log*

# Editor
.vscode/
.idea/
*.swp

# Build artifacts
dist/
build/

# Local test state
/tmp-data/
```

- [ ] **Step 3: Commit**

```bash
cd /home/yanek/Projects/index
git add packages/openclaw-for-railway/LICENSE packages/openclaw-for-railway/.gitignore
git commit -m "chore(openclaw-for-railway): bootstrap repo skeleton with MIT license"
```

---

## Task 2: railway.toml and parse test

**Files:**
- Create: `packages/openclaw-for-railway/railway.toml`
- Create: `packages/openclaw-for-railway/scripts/test-railway-toml.sh`

- [ ] **Step 1: Write the failing test**

Create `packages/openclaw-for-railway/scripts/test-railway-toml.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
TOML="$REPO_ROOT/railway.toml"

if [ ! -f "$TOML" ]; then
  echo "FAIL: $TOML does not exist"
  exit 1
fi

# Parse TOML using python3's tomllib (Python 3.11+). Fall back to `taplo` if unavailable.
if python3 -c 'import tomllib' 2>/dev/null; then
  python3 -c "
import tomllib, sys
with open('$TOML', 'rb') as f:
    data = tomllib.load(f)
assert data['build']['builder'] == 'DOCKERFILE', 'build.builder must be DOCKERFILE'
assert data['build']['dockerfilePath'] == 'Dockerfile', 'build.dockerfilePath must be Dockerfile'
assert data['deploy']['restartPolicyType'] == 'on_failure', 'deploy.restartPolicyType must be on_failure'
assert 'healthcheckPath' not in data['deploy'], 'deploy.healthcheckPath must be absent'
print('OK: railway.toml parsed and assertions passed')
"
elif command -v taplo >/dev/null 2>&1; then
  taplo check "$TOML"
else
  echo "FAIL: neither python3 tomllib nor taplo is available"
  exit 1
fi
```

Make it executable:

```bash
chmod +x packages/openclaw-for-railway/scripts/test-railway-toml.sh
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd /home/yanek/Projects/index/packages/openclaw-for-railway
./scripts/test-railway-toml.sh
```

Expected: `FAIL: /home/yanek/Projects/index/packages/openclaw-for-railway/railway.toml does not exist`

- [ ] **Step 3: Create railway.toml**

```toml
# Railway config-as-code for openclaw-for-railway
# Schema: https://railway.com/railway.schema.json
# Note: Template variable functions like ${{secret(n)}} and user-prompted
# variables (OPENCLAW_PROVIDER, OPENAI_API_KEY, GEMINI_API_KEY) are declared
# in the Railway template dashboard form when publishing this repo as a
# template. They are NOT declared here.

[build]
builder = "DOCKERFILE"
dockerfilePath = "Dockerfile"

[deploy]
restartPolicyType = "on_failure"
restartPolicyMaxRetries = 10
# No healthcheckPath — Railway uses TCP/process-alive check. Avoids coupling
# the healthcheck to the gateway auth token.
```

- [ ] **Step 4: Run test to verify it passes**

```bash
./scripts/test-railway-toml.sh
```

Expected: `OK: railway.toml parsed and assertions passed`

- [ ] **Step 5: Commit**

```bash
cd /home/yanek/Projects/index
git add packages/openclaw-for-railway/railway.toml packages/openclaw-for-railway/scripts/test-railway-toml.sh
git commit -m "feat(openclaw-for-railway): add railway.toml with parse test"
```

---

## Task 3: config.json5.template and envsubst test

**Files:**
- Create: `packages/openclaw-for-railway/config.json5.template`
- Create: `packages/openclaw-for-railway/scripts/test-config-template.sh`

- [ ] **Step 1: Write the failing test**

Create `packages/openclaw-for-railway/scripts/test-config-template.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
TEMPLATE="$REPO_ROOT/config.json5.template"

if [ ! -f "$TEMPLATE" ]; then
  echo "FAIL: $TEMPLATE does not exist"
  exit 1
fi

if ! command -v envsubst >/dev/null 2>&1; then
  echo "FAIL: envsubst not installed (apt-get install gettext-base)"
  exit 1
fi

TMP="$(mktemp)"
trap 'rm -f "$TMP"' EXIT

# Fixture env vars
export PORT=18789
export OPENCLAW_GATEWAY_TOKEN="test-gateway-token"
export OPENCLAW_HOOKS_TOKEN="test-hooks-token"
export OPENCLAW_PROVIDER="openai"
export RAILWAY_PUBLIC_DOMAIN="example.up.railway.app"

envsubst < "$TEMPLATE" > "$TMP"

# Assertions — grep for literal substituted values
grep -q 'port: 18789' "$TMP" || { echo "FAIL: PORT not substituted"; exit 1; }
grep -q '"test-gateway-token"' "$TMP" || { echo "FAIL: OPENCLAW_GATEWAY_TOKEN not substituted"; exit 1; }
grep -q '"test-hooks-token"' "$TMP" || { echo "FAIL: OPENCLAW_HOOKS_TOKEN not substituted"; exit 1; }
grep -q '"https://example.up.railway.app"' "$TMP" || { echo "FAIL: RAILWAY_PUBLIC_DOMAIN not substituted"; exit 1; }
grep -q 'provider: "openai"' "$TMP" || { echo "FAIL: OPENCLAW_PROVIDER not substituted in memorySearch"; exit 1; }

# Structural assertions — config must contain all required sections
for key in 'gateway:' 'hooks:' 'plugins:' 'agents:' 'memorySearch:' 'controlUi:' 'bindAddress: "0.0.0.0"' 'mode: "token"' 'enabled: true'; do
  grep -q "$key" "$TMP" || { echo "FAIL: missing required key/value: $key"; exit 1; }
done

echo "OK: config.json5.template renders correctly with all required sections"
```

```bash
chmod +x packages/openclaw-for-railway/scripts/test-config-template.sh
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd /home/yanek/Projects/index/packages/openclaw-for-railway
./scripts/test-config-template.sh
```

Expected: `FAIL: /home/yanek/Projects/index/packages/openclaw-for-railway/config.json5.template does not exist`

- [ ] **Step 3: Create config.json5.template**

```json5
// Rendered on every boot by entrypoint.sh via envsubst.
// Source of truth for gateway/hooks/plugins/agents config in this template.
// User-facing variables are declared in the Railway template dashboard form;
// Railway-generated secrets are also declared there via ${{secret(n)}}.
{
  gateway: {
    mode: "local",
    port: ${PORT},
    bind: "custom",
    bindAddress: "0.0.0.0",
    auth: {
      mode: "token",
      token: "${OPENCLAW_GATEWAY_TOKEN}",
      rateLimit: { maxAttempts: 10, windowMs: 60000, lockoutMs: 300000 },
    },
    controlUi: {
      enabled: true,
      allowedOrigins: ["https://${RAILWAY_PUBLIC_DOMAIN}"],
    },
    tools: { allow: [], deny: [] },
  },
  hooks: {
    enabled: true,
    token: "${OPENCLAW_HOOKS_TOKEN}",
    path: "/hooks",
    defaultSessionKey: "hook:ingress",
    allowRequestSessionKey: false,
    allowedSessionKeyPrefixes: ["hook:"],
    mappings: [],
  },
  plugins: {
    enabled: true,
    allow: [],
    deny: [],
    load: { paths: ["/data/.openclaw/plugins"] },
    entries: {},
  },
  agents: {
    defaults: {
      memorySearch: {
        enabled: true,
        provider: "${OPENCLAW_PROVIDER}",
        fallback: "none",
      },
    },
  },
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
./scripts/test-config-template.sh
```

Expected: `OK: config.json5.template renders correctly with all required sections`

- [ ] **Step 5: Commit**

```bash
cd /home/yanek/Projects/index
git add packages/openclaw-for-railway/config.json5.template packages/openclaw-for-railway/scripts/test-config-template.sh
git commit -m "feat(openclaw-for-railway): add config.json5.template with envsubst test"
```

---

## Task 4: entrypoint.sh with mocked-openclaw test

**Files:**
- Create: `packages/openclaw-for-railway/entrypoint.sh`
- Create: `packages/openclaw-for-railway/scripts/test-entrypoint.sh`

- [ ] **Step 1: Write the failing test**

Create `packages/openclaw-for-railway/scripts/test-entrypoint.sh`:

```bash
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
# Exit 0 for onboard; the `exec node ...` final line will be intercepted by
# the fake `node` below so we never actually run a gateway.
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

# Patch the entrypoint's path to opt/openclaw-railway so it reads the tmp template.
# The entrypoint references /opt/openclaw-railway/config.json5.template; for the
# unit test we rebind it by running the script through `sh` with the working
# directory and an environment override. Simpler: use OPENCLAW_RAILWAY_TEMPLATE_DIR.
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
grep -q 'gateway --bind custom --port 18789' "$NODE_CALL_LOG" || { echo "FAIL: gateway not execed"; cat "$NODE_CALL_LOG"; exit 1; }

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
```

```bash
chmod +x packages/openclaw-for-railway/scripts/test-entrypoint.sh
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd /home/yanek/Projects/index/packages/openclaw-for-railway
./scripts/test-entrypoint.sh
```

Expected: `FAIL: /home/yanek/Projects/index/packages/openclaw-for-railway/entrypoint.sh does not exist`

- [ ] **Step 3: Create entrypoint.sh**

```sh
#!/bin/sh
# entrypoint.sh — runs at container boot on Railway.
#
#   1. Ensure volume layout.
#   2. On fresh volume, run `openclaw onboard` non-interactively with the
#      user-selected provider (openai or gemini). Skip if marker file exists
#      and OPENCLAW_REONBOARD is not set.
#   3. Render /opt/openclaw-railway/config.json5.template via envsubst into
#      $XDG_CONFIG_HOME/config.json5. This runs on every boot so Railway
#      variable changes always propagate — no stale config on the volume.
#   4. Exec the OpenClaw gateway bound to 0.0.0.0:$PORT.
#
# All variables are supplied by the Railway template dashboard form.
# OPENCLAW_PROVIDER, OPENAI_API_KEY, GEMINI_API_KEY — user-prompted.
# OPENCLAW_GATEWAY_TOKEN, OPENCLAW_HOOKS_TOKEN, GOG_KEYRING_PASSWORD — ${{secret(n)}}.
# PORT, XDG_CONFIG_HOME, RAILWAY_PUBLIC_DOMAIN — Railway-provided or defaults.

set -e

: "${PORT:=18789}"
: "${XDG_CONFIG_HOME:=/data/.openclaw}"
: "${OPENCLAW_RAILWAY_TEMPLATE_DIR:=/opt/openclaw-railway}"

mkdir -p "$XDG_CONFIG_HOME"

MARKER="$XDG_CONFIG_HOME/.railway-onboarded"
if [ -n "${OPENCLAW_PROVIDER:-}" ] && { [ ! -f "$MARKER" ] || [ "${OPENCLAW_REONBOARD:-}" = "1" ]; }; then
  case "$OPENCLAW_PROVIDER" in
    openai)
      : "${OPENAI_API_KEY:?OPENAI_API_KEY required when OPENCLAW_PROVIDER=openai}"
      openclaw onboard --non-interactive --mode local \
        --auth-choice openai-api-key \
        --openai-api-key "$OPENAI_API_KEY" \
        --gateway-port "$PORT" \
        --gateway-bind custom
      ;;
    gemini)
      : "${GEMINI_API_KEY:?GEMINI_API_KEY required when OPENCLAW_PROVIDER=gemini}"
      openclaw onboard --non-interactive --mode local \
        --auth-choice gemini-api-key \
        --gemini-api-key "$GEMINI_API_KEY" \
        --gateway-port "$PORT" \
        --gateway-bind custom
      ;;
    *)
      echo "OPENCLAW_PROVIDER must be 'openai' or 'gemini' (got: '$OPENCLAW_PROVIDER'). Skipping onboarding." >&2
      ;;
  esac
  touch "$MARKER"
fi

envsubst < "$OPENCLAW_RAILWAY_TEMPLATE_DIR/config.json5.template" > "$XDG_CONFIG_HOME/config.json5"

exec node dist/index.js gateway --bind custom --port "$PORT" --allow-unconfigured
```

Make it executable:

```bash
chmod +x packages/openclaw-for-railway/entrypoint.sh
```

- [ ] **Step 4: Run test to verify it passes**

```bash
./scripts/test-entrypoint.sh
```

Expected: `OK: entrypoint passes all assertions (onboard once, skip on marker, force with REONBOARD)`

- [ ] **Step 5: Commit**

```bash
cd /home/yanek/Projects/index
git add packages/openclaw-for-railway/entrypoint.sh packages/openclaw-for-railway/scripts/test-entrypoint.sh
git commit -m "feat(openclaw-for-railway): add entrypoint.sh with mocked unit test"
```

---

## Task 5: Dockerfile with hadolint + build test

**Files:**
- Create: `packages/openclaw-for-railway/Dockerfile`
- Create: `packages/openclaw-for-railway/scripts/test-dockerfile.sh`

- [ ] **Step 1: Write the failing test**

Create `packages/openclaw-for-railway/scripts/test-dockerfile.sh`:

```bash
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
```

```bash
chmod +x packages/openclaw-for-railway/scripts/test-dockerfile.sh
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd /home/yanek/Projects/index/packages/openclaw-for-railway
./scripts/test-dockerfile.sh
```

Expected: `FAIL: /home/yanek/Projects/index/packages/openclaw-for-railway/Dockerfile does not exist`

- [ ] **Step 3: Create Dockerfile**

```dockerfile
# syntax=docker/dockerfile:1.6

# Thin overlay on the official OpenClaw image. No OpenClaw build step —
# we only add the Railway-specific entrypoint and config template.
FROM openclaw/openclaw:latest

USER root

# envsubst ships with gettext-base. Install only if missing so rebuilds are
# cheap when the base image already includes it.
RUN if ! command -v envsubst >/dev/null 2>&1; then \
      apt-get update \
      && apt-get install -y --no-install-recommends gettext-base \
      && rm -rf /var/lib/apt/lists/*; \
    fi

COPY --chown=node:node config.json5.template /opt/openclaw-railway/config.json5.template
COPY --chown=node:node --chmod=0755 entrypoint.sh /opt/openclaw-railway/entrypoint.sh

USER node

ENTRYPOINT ["/opt/openclaw-railway/entrypoint.sh"]
```

- [ ] **Step 4: Run test to verify it passes**

```bash
./scripts/test-dockerfile.sh
```

Expected: `OK: Dockerfile static checks passed`

- [ ] **Step 5: Commit**

```bash
cd /home/yanek/Projects/index
git add packages/openclaw-for-railway/Dockerfile packages/openclaw-for-railway/scripts/test-dockerfile.sh
git commit -m "feat(openclaw-for-railway): add Dockerfile with hadolint test"
```

---

## Task 6: Full container smoke test

**Files:**
- Create: `packages/openclaw-for-railway/scripts/smoke-test.sh`

- [ ] **Step 1: Write the smoke test**

Create `packages/openclaw-for-railway/scripts/smoke-test.sh`:

```bash
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
```

```bash
chmod +x packages/openclaw-for-railway/scripts/smoke-test.sh
```

- [ ] **Step 2: Run the smoke test**

```bash
cd /home/yanek/Projects/index/packages/openclaw-for-railway
./scripts/smoke-test.sh
```

Expected: `OK: smoke test passed (build, run, render, listen, skip-re-onboard)`

If the `openclaw/openclaw:latest` base image does not support `--auth-choice openai-api-key` or the onboarding command exits non-zero, diagnose by running:

```bash
docker run --rm -it openclaw/openclaw:latest sh -c 'openclaw onboard --help' 2>&1 | head -40
```

If flags have drifted, update `entrypoint.sh` to match current upstream and re-run the smoke test. Document any deviation in the commit message.

- [ ] **Step 3: Commit**

```bash
cd /home/yanek/Projects/index
git add packages/openclaw-for-railway/scripts/smoke-test.sh
git commit -m "test(openclaw-for-railway): add full container smoke test"
```

---

## Task 7: README.md with deploy button

**Files:**
- Create: `packages/openclaw-for-railway/README.md`
- Create: `packages/openclaw-for-railway/scripts/test-readme.sh`

- [ ] **Step 1: Write the failing test**

Create `packages/openclaw-for-railway/scripts/test-readme.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
README="$REPO_ROOT/README.md"

if [ ! -f "$README" ]; then
  echo "FAIL: $README does not exist"
  exit 1
fi

# Required sections (by heading text match, case-insensitive)
for section in 'Deploy on Railway' 'What this deploys' 'What you must supply' 'After deploy' 'Verify the webhook' "What's not included"; do
  grep -qi "$section" "$README" || { echo "FAIL: README missing section: $section"; exit 1; }
done

# Deploy button must be a markdown image linked to a railway.com URL.
grep -Eq '!\[[^]]*\]\(https://railway\.com/button\.svg\)\]\(https://railway\.com/(new/template|deploy)/' "$README" || {
  echo "FAIL: README missing Deploy on Railway button with railway.com target"
  exit 1
}

echo "OK: README has all required sections and deploy button"
```

```bash
chmod +x packages/openclaw-for-railway/scripts/test-readme.sh
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd /home/yanek/Projects/index/packages/openclaw-for-railway
./scripts/test-readme.sh
```

Expected: `FAIL: /home/yanek/Projects/index/packages/openclaw-for-railway/README.md does not exist`

- [ ] **Step 3: Create README.md**

````markdown
# openclaw-for-railway

One-click deploy template for a fully-featured [OpenClaw](https://openclaw.ai) gateway on [Railway](https://railway.com). All OpenClaw capabilities enabled by default — Control UI, webhooks, plugins, tools, memory/semantic search — with Railway-generated secrets and a single user-supplied LLM provider key.

[![Deploy on Railway](https://railway.com/button.svg)](https://railway.com/new/template/REPLACE_TEMPLATE_ID?utm_medium=integration&utm_source=button&utm_campaign=openclaw-for-railway)

> **Note:** The button above links to `REPLACE_TEMPLATE_ID` until the template is published in the Railway dashboard. Replace that ID after publishing.

## What this deploys

- A single Railway service running the official `openclaw/openclaw:latest` image.
- A persistent volume mounted at `/data` for OpenClaw state, config, plugins, and provider credentials.
- A public Railway domain (`*.up.railway.app`) with TLS termination at Railway's edge.
- Auto-generated secrets: gateway auth token, webhook auth token, and keyring password. You never see or type them in plain text.
- A gateway config with **every OpenClaw feature turned on**: webhooks (`/hooks`), plugins subsystem, Control UI, `/tools/invoke`, and semantic memory search.

## What you must supply

Two Railway-prompted variables during deploy:

| Variable | Values |
|---|---|
| `OPENCLAW_PROVIDER` | `openai` *or* `gemini` |
| `OPENAI_API_KEY` *or* `GEMINI_API_KEY` | your provider API key (matches the provider choice) |

That's it. The reason the initial picker is limited to these two providers is that both ship chat *and* embeddings from one credential, so memory/semantic search works immediately. You can swap to any other OpenClaw-supported provider after deploy by re-running `openclaw onboard` in the Railway shell.

## After deploy

1. Wait for the deploy to go green in Railway.
2. Open the service's public domain (`https://<project>.up.railway.app/`).
3. The Control UI loads and asks for a gateway token. In Railway, go to the service → **Variables** tab → copy `OPENCLAW_GATEWAY_TOKEN` → paste it into the Control UI.
4. You're in. The provider you selected is already onboarded, memory search is already wired.

## Verify the webhook surface

OpenClaw webhooks are protected by a shared secret separate from the gateway token. A quick one-liner proves reachability and auth:

```bash
# Unauthenticated → 401
curl -sS -o /dev/null -w '%{http_code}\n' \
  -X POST "https://<your-domain>/hooks/ping"

# Authenticated → non-401 (200 or mapping-defined response)
curl -sS -o /dev/null -w '%{http_code}\n' \
  -X POST "https://<your-domain>/hooks/ping" \
  -H "Authorization: Bearer $OPENCLAW_HOOKS_TOKEN"
```

Copy `OPENCLAW_HOOKS_TOKEN` from Railway Variables for the second call.

## Rotating credentials

- **Rotate the LLM API key**: update the `OPENAI_API_KEY` or `GEMINI_API_KEY` variable in Railway, then set `OPENCLAW_REONBOARD=1` and redeploy. Unset `OPENCLAW_REONBOARD` afterwards so subsequent restarts don't re-onboard.
- **Rotate the gateway or hooks token**: regenerate the variable value in Railway and redeploy. No data on the volume is affected.
- **Do NOT rotate `GOG_KEYRING_PASSWORD`**: it encrypts persisted provider credentials on the volume. Rotating it will brick the keyring. If you must rotate it, also wipe the `/data` volume and re-onboard from scratch.

## What's not included

This template is deliberately minimal and vendor-neutral:

- No Tailscale funneling, no `trustedProxies`, no `trusted-proxy` auth mode.
- No Index Network plugin preinstall — install any plugin you want post-deploy.
- No APNS push relay.
- No automated backups of the `/data` volume (Railway owns that).
- No secondary/failover provider.

If you need any of these, treat them as post-deploy configuration via the Control UI or by editing config in the Railway shell.

## How it works

```
Railway deploy
  └─ docker build (FROM openclaw/openclaw:latest + entrypoint + config template)
       └─ container start
            ├─ entrypoint: openclaw onboard --non-interactive (first boot only)
            ├─ entrypoint: envsubst config.json5.template → /data/.openclaw/config.json5
            └─ exec openclaw gateway --bind custom --port $PORT --allow-unconfigured
```

The config template is rendered from Railway environment variables on *every* boot, so any variable change + redeploy immediately takes effect. The onboarding marker file (`/data/.openclaw/.railway-onboarded`) prevents wasted re-onboarding on reboot.

## License

MIT. See [LICENSE](./LICENSE).

## Upstream

- [OpenClaw](https://github.com/openclaw/openclaw) — upstream project.
- [OpenClaw docs](https://docs.openclaw.ai).
````

- [ ] **Step 4: Run test to verify it passes**

```bash
./scripts/test-readme.sh
```

Expected: `OK: README has all required sections and deploy button`

- [ ] **Step 5: Commit**

```bash
cd /home/yanek/Projects/index
git add packages/openclaw-for-railway/README.md packages/openclaw-for-railway/scripts/test-readme.sh
git commit -m "docs(openclaw-for-railway): add README with deploy button and post-deploy guide"
```

---

## Task 8: GitHub Actions CI workflow

**Files:**
- Create: `packages/openclaw-for-railway/.github/workflows/ci.yml`

- [ ] **Step 1: Create CI workflow**

```yaml
name: ci

on:
  push:
    branches: [main, dev]
    paths:
      - 'packages/openclaw-for-railway/**'
  pull_request:
    paths:
      - 'packages/openclaw-for-railway/**'

defaults:
  run:
    working-directory: packages/openclaw-for-railway

jobs:
  static:
    name: static checks
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Install prerequisites
        run: |
          sudo apt-get update
          sudo apt-get install -y gettext-base shellcheck python3
          # hadolint
          sudo wget -qO /usr/local/bin/hadolint https://github.com/hadolint/hadolint/releases/latest/download/hadolint-Linux-x86_64
          sudo chmod +x /usr/local/bin/hadolint

      - name: railway.toml parse
        run: ./scripts/test-railway-toml.sh

      - name: config.json5.template envsubst
        run: ./scripts/test-config-template.sh

      - name: entrypoint.sh unit test
        run: ./scripts/test-entrypoint.sh

      - name: Dockerfile static checks
        run: ./scripts/test-dockerfile.sh

      - name: README.md structure + deploy button
        run: ./scripts/test-readme.sh

  smoke:
    name: docker smoke test
    runs-on: ubuntu-latest
    needs: static
    steps:
      - uses: actions/checkout@v4

      - name: Smoke test (build + run)
        run: ./scripts/smoke-test.sh
```

- [ ] **Step 2: Commit**

```bash
cd /home/yanek/Projects/index
git add packages/openclaw-for-railway/.github/workflows/ci.yml
git commit -m "ci(openclaw-for-railway): add hadolint + smoke test workflow"
```

---

## Task 9: Publishing checklist (manual, documented)

**Files:**
- Create: `packages/openclaw-for-railway/PUBLISHING.md`

- [ ] **Step 1: Document the publishing steps**

```markdown
# Publishing this repo as a Railway template

These steps run once, by a maintainer with a Railway account, to turn the
repo into a clickable template.

## 1. Push the repo to a public GitHub location

The Railway template form reads from a public GitHub repo. This monorepo
subtree needs to be pushed to `github.com/indexnetwork/openclaw-for-railway`
(or similar) as a standalone repo. The monorepo maintains the source via
`git subtree push --prefix=packages/openclaw-for-railway ...` when ready.

## 2. Create a new template in the Railway dashboard

1. Sign in to Railway → Templates → Create Template.
2. Source: GitHub repo → the public mirror URL.
3. Root directory: `/` (the mirror is standalone).
4. Builder: detected from `railway.toml` (DOCKERFILE).

## 3. Declare the variable prompts

In the template form, declare each variable:

| Name | Type | Value / prompt |
|---|---|---|
| `OPENCLAW_PROVIDER` | enum | options `openai`, `gemini` — user-selected |
| `OPENAI_API_KEY` | secret | user-prompted, required when provider=openai |
| `GEMINI_API_KEY` | secret | user-prompted, required when provider=gemini |
| `OPENCLAW_GATEWAY_TOKEN` | generated | `${{secret(64)}}` |
| `OPENCLAW_HOOKS_TOKEN` | generated | `${{secret(64)}}` |
| `GOG_KEYRING_PASSWORD` | generated | `${{secret(32)}}` |
| `PORT` | fixed | `18789` |
| `XDG_CONFIG_HOME` | fixed | `/data/.openclaw` |

## 4. Attach the persistent volume

- Mount path: `/data`
- Size: 1 GB is plenty for provider-backed memory search.

## 5. Enable public networking

- Public domain: yes.
- Port: `18789`.

## 6. Publish and test

- Publish the template. Railway assigns an ID.
- Take the ID and update the README deploy button URL to replace
  `REPLACE_TEMPLATE_ID`.
- Commit the README update.

## 7. Sanity deploy

Click the button in a fresh Railway account, supply a real OpenAI or Gemini
API key, and run the post-deploy checklist in the README. Verify:

- Gateway responds on the public domain.
- Control UI accepts the auto-generated gateway token.
- `curl -X POST https://.../hooks/ping` returns 401 unauthenticated.
- Memory/semantic search is active in the Control UI status panel.
```

- [ ] **Step 2: Commit**

```bash
cd /home/yanek/Projects/index
git add packages/openclaw-for-railway/PUBLISHING.md
git commit -m "docs(openclaw-for-railway): add Railway template publishing checklist"
```

---

## Task 10: Run full local verification

**Files:** no new files.

- [ ] **Step 1: Run every test script in order**

```bash
cd /home/yanek/Projects/index/packages/openclaw-for-railway
./scripts/test-railway-toml.sh
./scripts/test-config-template.sh
./scripts/test-entrypoint.sh
./scripts/test-dockerfile.sh
./scripts/test-readme.sh
./scripts/smoke-test.sh
```

Expected: every script ends with `OK: ...`.

- [ ] **Step 2: Report**

Summarize results and any deviations from upstream OpenClaw CLI flags encountered during the smoke test. Do NOT auto-merge to `dev`; stop here and hand back to the user for review and worktree integration.

---

## Self-review

### Spec coverage

- Architecture (thin overlay + entrypoint + envsubst) → Tasks 3, 4, 5.
- Runtime shape (`--bind custom`, `--allow-unconfigured`, XDG redirect) → Task 4 entrypoint + Task 5 Dockerfile.
- All OpenClaw features enabled by default (gateway/hooks/plugins/tools/agents/memorySearch) → Task 3 config template with assertions on each section.
- Token auth with Railway-generated secrets (64-char) → Task 3 template + Task 9 publishing doc.
- Separate hooks token + controlUi allowedOrigins locked to RAILWAY_PUBLIC_DOMAIN → Task 3 template + Task 3 assertions.
- `memorySearch.provider` mirrors chat provider (openai/gemini) → Task 3 template + assertion.
- Persistent volume at `/data`, `XDG_CONFIG_HOME=/data/.openclaw` → Task 4 entrypoint + Task 6 smoke test bind mount.
- Marker-file idempotent onboarding + `OPENCLAW_REONBOARD=1` override → Task 4 entrypoint + Task 4 mocked test + Task 6 smoke test second run.
- `railway.toml` DOCKERFILE builder, no healthcheckPath, on_failure restart → Task 2 parse test + file.
- Risk mitigation: run onboarding *before* envsubst so our template wins last-writer → Task 4 entrypoint ordering.
- Risk mitigation: assume empty `${OPENCLAW_PROVIDER}` is auto-detect. If smoke test reveals this breaks, the entrypoint must post-process the rendered file. Task 6 documents the diagnostic command for CLI drift; extend the entrypoint if needed and re-run the smoke test.
- Security boundaries (rate limiter, allowRequestSessionKey=false, plugins load path constrained) → Task 3 template structural assertions.
- README surface (deploy button, post-deploy UX, webhook check, rotation, non-goals) → Task 7 + link/section test.
- CI (hadolint + shellcheck + smoke test) → Task 8.
- Publishing flow (manual template dashboard) → Task 9.
- Definition of done (tests pass + one live deploy) → Task 10.

### Placeholder scan

No TODOs, TBDs, or "implement later" phrases. Every step includes the actual content the subagent needs. The README contains `REPLACE_TEMPLATE_ID` as a deliberate, explicit placeholder that Task 9 instructs the maintainer to replace — this is NOT a plan placeholder; it's a user-facing marker.

### Type / name consistency

- Env var names used consistently: `OPENCLAW_PROVIDER`, `OPENAI_API_KEY`, `GEMINI_API_KEY`, `OPENCLAW_GATEWAY_TOKEN`, `OPENCLAW_HOOKS_TOKEN`, `GOG_KEYRING_PASSWORD`, `PORT`, `XDG_CONFIG_HOME`, `RAILWAY_PUBLIC_DOMAIN`, `OPENCLAW_REONBOARD`.
- Marker file path consistent: `$XDG_CONFIG_HOME/.railway-onboarded` everywhere.
- Template install path consistent: `/opt/openclaw-railway/` (overridable via `OPENCLAW_RAILWAY_TEMPLATE_DIR` for unit tests).
- Volume mount path consistent: `/data`.

No drift.
