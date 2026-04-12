#!/bin/bash
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

# OpenClaw stores its runtime config (openclaw.json, keyring, sessions,
# workspace) under $HOME/.openclaw regardless of $XDG_CONFIG_HOME. Point
# $HOME at the persistent Railway volume so restarts preserve state.
# OPENCLAW_HOME_DIR is an override hook for unit tests.
: "${OPENCLAW_HOME_DIR:=/data}"
export HOME="$OPENCLAW_HOME_DIR"

mkdir -p "$XDG_CONFIG_HOME" "$HOME/.openclaw"

MARKER="$XDG_CONFIG_HOME/.railway-onboarded"
if [ -n "${OPENCLAW_PROVIDER:-}" ] && { [ ! -f "$MARKER" ] || [ "${OPENCLAW_REONBOARD:-}" = "1" ]; }; then
  case "$OPENCLAW_PROVIDER" in
    openai)
      : "${OPENAI_API_KEY:?OPENAI_API_KEY required when OPENCLAW_PROVIDER=openai}"
      # --accept-risk: required when binding non-loopback for Railway public ingress.
      # --skip-health: `openclaw onboard` probes for a running gateway after
      #                writing config and exits non-zero if none is reachable.
      #                We start the gateway AFTER onboarding, so the probe must
      #                be skipped or the entrypoint dies on its own chicken-and-egg.
      openclaw onboard --non-interactive --mode local --accept-risk --skip-health \
        --auth-choice openai-api-key \
        --openai-api-key "$OPENAI_API_KEY" \
        --gateway-port "$PORT" \
        --gateway-bind lan
      ;;
    gemini)
      : "${GEMINI_API_KEY:?GEMINI_API_KEY required when OPENCLAW_PROVIDER=gemini}"
      openclaw onboard --non-interactive --mode local --accept-risk --skip-health \
        --auth-choice gemini-api-key \
        --gemini-api-key "$GEMINI_API_KEY" \
        --gateway-port "$PORT" \
        --gateway-bind lan
      ;;
    *)
      echo "OPENCLAW_PROVIDER must be 'openai' or 'gemini' (got: '$OPENCLAW_PROVIDER'). Skipping onboarding." >&2
      ;;
  esac
  touch "$MARKER"
fi

envsubst < "$OPENCLAW_RAILWAY_TEMPLATE_DIR/config.json5.template" > "$XDG_CONFIG_HOME/config.json5"

# Pre-install the Index Network plugin from the marketplace repo.
#
# `openclaw plugins install <id> --marketplace <repo>` normally does this,
# but the CLI routes through a gateway scope-upgrade handshake that blocks
# on device pairing on first boot — unusable from a subagent in a fresh
# Railway deploy. The plugin loader already scans plugins.load.paths (see
# config.json5.template), so dropping an extracted tarball in place is
# functionally equivalent. The plugin ships TypeScript source and has no
# runtime npm deps, so no build step is required.
if [ -n "${INDEX_NETWORK_MCP_URL:-}" ]; then
  : "${INDEX_NETWORK_PLUGIN_REPO:=https://github.com/indexnetwork/openclaw-plugin}"
  : "${INDEX_NETWORK_PLUGIN_REF:=main}"
  PLUGINS_ROOT="$XDG_CONFIG_HOME/plugins"
  PLUGIN_DIR="$PLUGINS_ROOT/indexnetwork-openclaw-plugin"

  if [ ! -f "$PLUGIN_DIR/openclaw.plugin.json" ] || [ "${INDEX_NETWORK_PLUGIN_REFRESH:-}" = "1" ]; then
    mkdir -p "$PLUGINS_ROOT"
    TARBALL_URL="${INDEX_NETWORK_PLUGIN_REPO%.git}/archive/refs/heads/${INDEX_NETWORK_PLUGIN_REF}.tar.gz"
    PLUGIN_STAGE="${PLUGIN_DIR}.new"
    rm -rf "$PLUGIN_STAGE"
    mkdir -p "$PLUGIN_STAGE"
    # Scoped pipefail so curl failures (404, truncated stream, DNS error) fail
    # the branch instead of being masked by tar's exit status on partial input.
    # `set -e` alone does not catch mid-pipeline failures.
    if (set -o pipefail; curl -fsSL "$TARBALL_URL" | tar -xz -C "$PLUGIN_STAGE" --strip-components=1); then
      rm -rf "$PLUGIN_DIR"
      mv "$PLUGIN_STAGE" "$PLUGIN_DIR"
      echo "[openclaw-for-railway] installed Index Network plugin from ${INDEX_NETWORK_PLUGIN_REPO}@${INDEX_NETWORK_PLUGIN_REF} -> $PLUGIN_DIR"
    else
      rm -rf "$PLUGIN_STAGE"
      echo "[openclaw-for-railway] WARN: failed to download $TARBALL_URL; index-network plugin not installed" >&2
    fi
  fi
fi

# Patch openclaw.json on every boot with the Railway-specific Control UI
# settings and — if INDEX_NETWORK_MCP_URL is set — the Index Network MCP
# server entry. `openclaw onboard` writes a default config tuned for local
# personal-device use, so several fields are either missing or set to
# personal-device defaults that fight a Railway public deployment:
#
#   1. gateway.controlUi.allowedOrigins — unset by default, causing
#      "origin not allowed" rejection of the browser's WebSocket.
#   2. gateway.controlUi.dangerouslyDisableDeviceAuth — OpenClaw's default
#      is to require a second-factor device-pairing handshake on every
#      connection, on the assumption the gateway runs on a trusted local
#      device. On Railway, the 64-char OPENCLAW_GATEWAY_TOKEN IS the auth
#      boundary; pairing adds no value and breaks the "log in from any
#      browser with the token" UX the template exists to provide.
#   3. mcp["index-network"] — normally written by `openclaw mcp set`, but
#      that CLI command hits the same scope-upgrade device-pairing wall as
#      `openclaw plugins install`. File-patching bypasses it.
#
# Running this on every boot (not gated by the onboarding marker) means
# changing RAILWAY_PUBLIC_DOMAIN / INDEX_NETWORK_MCP_URL / INDEX_NETWORK_API_KEY
# + redeploy is the only knob — no drift, no manual dashboard edits.
if [ -f "$HOME/.openclaw/openclaw.json" ] && { [ -n "${RAILWAY_PUBLIC_DOMAIN:-}" ] || [ -n "${INDEX_NETWORK_MCP_URL:-}" ]; }; then
  INDEX_NETWORK_MCP_URL="${INDEX_NETWORK_MCP_URL:-}" \
  INDEX_NETWORK_API_KEY="${INDEX_NETWORK_API_KEY:-}" \
  node -e '
    const fs = require("fs");
    const p = process.env.HOME + "/.openclaw/openclaw.json";
    const before = fs.readFileSync(p, "utf8");
    const config = JSON.parse(before);
    const touched = [];

    if (process.env.RAILWAY_PUBLIC_DOMAIN) {
      config.gateway = config.gateway || {};
      config.gateway.controlUi = config.gateway.controlUi || {};
      config.gateway.controlUi.enabled = true;
      config.gateway.controlUi.allowedOrigins = ["https://" + process.env.RAILWAY_PUBLIC_DOMAIN];
      config.gateway.controlUi.dangerouslyDisableDeviceAuth = true;
      touched.push("controlUi(allowedOrigins+dangerouslyDisableDeviceAuth) for https://" + process.env.RAILWAY_PUBLIC_DOMAIN);
    }

    if (process.env.INDEX_NETWORK_MCP_URL) {
      config.mcp = config.mcp || {};
      const entry = {
        url: process.env.INDEX_NETWORK_MCP_URL,
        transport: "streamable-http",
      };
      if (process.env.INDEX_NETWORK_API_KEY) {
        entry.headers = { "x-api-key": process.env.INDEX_NETWORK_API_KEY };
      }
      config.mcp["index-network"] = entry;
      touched.push("mcp.index-network -> " + process.env.INDEX_NETWORK_MCP_URL + (process.env.INDEX_NETWORK_API_KEY ? " (with x-api-key)" : " (no headers)"));
    }

    // Compare against a normalized round-trip of the original to avoid
    // rewriting when only whitespace differs. A no-op write bumps mtime,
    // which can trip OpenClaw config reload watchers and trigger the
    // SIGUSR1 gateway-restart loop we just fixed elsewhere in this file.
    const next = JSON.stringify(config, null, 2);
    const beforeNormalized = JSON.stringify(JSON.parse(before), null, 2);
    if (touched.length > 0 && next !== beforeNormalized) {
      fs.writeFileSync(p, next);
      console.log("[openclaw-for-railway] patched openclaw.json: " + touched.join("; "));
    }
  '
fi

# --- process supervision ---
#
# OpenClaw's SIGUSR1 "full process restart" (triggered by hot-reloadable config
# changes like adding the Telegram channel) forks a replacement node process
# and then exits the parent, on the assumption that an external supervisor
# will notice the exit and keep the replacement alive. If we `exec node` as
# pid 1, that parent-exit tears down the container and takes the replacement
# with it. Railway's own restart policy caps at 10 retries and gives up.
#
# Keeping bash as pid 1 lets us survive these restarts: when the original node
# exits after fork-spawning a detached replacement, the new pid is reparented
# to us, and `wait -n` keeps blocking until *every* gateway process is gone.
# Only then do we exit non-zero and let Railway's outer restart policy start
# a fresh container.
cleanup() {
  if [ -n "${GATEWAY_PID:-}" ]; then
    kill -TERM "$GATEWAY_PID" 2>/dev/null || true
  fi
  wait 2>/dev/null || true
  exit 0
}
trap cleanup TERM INT

node dist/index.js gateway --bind lan --port "$PORT" --allow-unconfigured &
GATEWAY_PID=$!

# `wait -n` reports child exit codes; rc=127 means no children remain.
# Temporarily disable set -e so a non-zero child exit doesn't kill the loop.
set +e
while true; do
  wait -n 2>/dev/null
  [ $? -eq 127 ] && break
done
set -e

echo "[openclaw-for-railway] no gateway processes remain; exiting so Railway restarts the container" >&2
exit 1
