# Design: `openclaw-for-railway` — One-Click OpenClaw Template for Railway

## Goal

Ship a standalone GitHub template repo that deploys a fully-featured OpenClaw gateway to Railway with one click. The deploy must be permissive-but-secure by default: every OpenClaw capability (Control UI, webhooks, plugins, tools, memory/semantic search) is enabled on first boot, and all trust boundaries are protected by strong auto-generated secrets. The only decisions the user makes are which LLM provider to use and where their API key comes from.

## Non-goals

- No Index Network plugin preinstall. Vendor-neutral template.
- No Tailscale wiring, `trustedProxies`, or `trusted-proxy` auth mode.
- No APNS push relay.
- No secondary/failover provider.
- No backup automation for the persistent volume (Railway owns that).
- No wrapper service, no sidecar, no custom `/setup` UI on top of OpenClaw.

## Scope summary

One Railway service, one container, one persistent volume, one public domain. The container is a thin overlay on the official `openclaw/openclaw:latest` image, comprising a ~15-line `Dockerfile`, a ~40-line `entrypoint.sh`, and a `config.json5.template`. Railway supplies the secrets via template variable functions; the user brings a provider API key.

## User experience

1. User clicks **Deploy on Railway** in the repo README.
2. Railway prompts for the required inputs (provider + API key). All other variables are auto-filled.
3. Railway builds the Dockerfile (~30–60 seconds) and starts the service.
4. Entrypoint runs non-interactive `openclaw onboard` on a fresh volume, renders `config.json5` from the template, then execs the gateway. TCP check turns green.
5. Railway assigns a public domain. User visits `https://<project>.up.railway.app/` → Control UI loads, prompts for token.
6. User copies `OPENCLAW_GATEWAY_TOKEN` from Railway Variables → pastes it → lands in OpenClaw with the provider already onboarded and memory/semantic search already wired.
7. Webhook verification: `curl -X POST https://<domain>/hooks/ping` returns `401` unauthenticated, returns mapping output when the hooks token header is supplied. This single curl is the "is my deploy reachable and secured" check documented in the README.

## Architecture

```
┌─────────────────────────────────────────────┐
│ Railway Service: openclaw                   │
│                                             │
│  Source: Dockerfile (repo)                  │
│    FROM openclaw/openclaw:latest            │
│    + entrypoint.sh                          │
│    + config.json5.template                  │
│                                             │
│  Boot: entrypoint.sh                        │
│    1. mkdir -p $XDG_CONFIG_HOME             │
│    2. [first boot only] openclaw onboard    │
│         --non-interactive --mode local ...  │
│    3. envsubst config.json5.template        │
│         → $XDG_CONFIG_HOME/config.json5     │
│    4. exec node dist/index.js gateway       │
│         --bind custom --port "$PORT"        │
│         --allow-unconfigured                │
│                                             │
│  Volume: /data (persists state + config)    │
│  Public domain: *.up.railway.app            │
└─────────────────────────────────────────────┘
```

### Runtime decisions

- **`--bind custom` + `bindAddress: "0.0.0.0"`**: Railway provides `PORT` and terminates TLS at its edge. The gateway must listen on a non-loopback interface inside the container. `bind: custom` is the documented escape hatch.
- **`--allow-unconfigured`**: keeps the gateway running even if config is missing or invalid, so the first deploy never enters a crash loop on a fresh volume.
- **`XDG_CONFIG_HOME=/data/.openclaw`**: redirects all OpenClaw state into the persistent volume in one move. This matches the pattern used in the official OpenClaw Docker docs.
- **No HTTP healthcheck**: Railway's TCP/process-alive check is enough. Using a real HTTP healthcheck would require an unauthenticated endpoint we don't want to expose, or require baking the token into the healthcheck config. Omitting `healthcheckPath` avoids both problems.
- **No sidecar**: the template is one process.

## Components

### `Dockerfile`

```dockerfile
FROM openclaw/openclaw:latest

COPY --chmod=0755 entrypoint.sh /opt/openclaw-railway/entrypoint.sh
COPY config.json5.template /opt/openclaw-railway/config.json5.template

# gettext ships envsubst; install only if missing.
USER root
RUN command -v envsubst >/dev/null 2>&1 || (apt-get update && apt-get install -y --no-install-recommends gettext-base && rm -rf /var/lib/apt/lists/*)
USER node

ENTRYPOINT ["/opt/openclaw-railway/entrypoint.sh"]
```

Intentionally minimal: no build step, no version pin, no package installs beyond `envsubst` (and only if the base image lacks it).

### `entrypoint.sh`

```sh
#!/bin/sh
set -e

: "${PORT:=18789}"
: "${XDG_CONFIG_HOME:=/data/.openclaw}"

mkdir -p "$XDG_CONFIG_HOME"

MARKER="$XDG_CONFIG_HOME/.railway-onboarded"
if [ -n "$OPENCLAW_PROVIDER" ] && { [ ! -f "$MARKER" ] || [ "$OPENCLAW_REONBOARD" = "1" ]; }; then
  case "$OPENCLAW_PROVIDER" in
    openai)
      : "${OPENAI_API_KEY:?OPENAI_API_KEY required when OPENCLAW_PROVIDER=openai}"
      openclaw onboard --non-interactive --mode local \
        --auth-choice openai-api-key --openai-api-key "$OPENAI_API_KEY" \
        --gateway-port "$PORT" --gateway-bind custom
      ;;
    gemini)
      : "${GEMINI_API_KEY:?GEMINI_API_KEY required when OPENCLAW_PROVIDER=gemini}"
      openclaw onboard --non-interactive --mode local \
        --auth-choice gemini-api-key --gemini-api-key "$GEMINI_API_KEY" \
        --gateway-port "$PORT" --gateway-bind custom
      ;;
    *)
      echo "OPENCLAW_PROVIDER must be 'openai' or 'gemini' (got: '$OPENCLAW_PROVIDER'). Skipping onboarding." >&2
      ;;
  esac
  touch "$MARKER"
fi

envsubst < /opt/openclaw-railway/config.json5.template > "$XDG_CONFIG_HOME/config.json5"

exec node dist/index.js gateway --bind custom --port "$PORT" --allow-unconfigured
```

Rendering the config on every boot means changing a Railway variable + redeploying is the only way to change config — no drift, no stale file on the volume.

### `config.json5.template`

```json5
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

When `OPENCLAW_PROVIDER` is unset, `provider` substitutes to an empty string; OpenClaw treats empty as auto-detect and `--allow-unconfigured` keeps the gateway running until the user sets it.

### `railway.toml`

```toml
[build]
builder = "DOCKERFILE"
dockerfilePath = "Dockerfile"

[deploy]
restartPolicyType = "on_failure"
restartPolicyMaxRetries = 10
# No healthcheckPath — Railway uses TCP / process-alive check.
```

Template variables (declared when publishing the template in the Railway dashboard, not in `railway.toml` directly — the dashboard template form owns `${{secret()}}` substitutions):

| Variable | Source | Purpose |
|---|---|---|
| `OPENCLAW_PROVIDER` | user-prompted, enum `openai` / `gemini` | Sole provider choice. Picks chat *and* embeddings. |
| `OPENAI_API_KEY` | user-prompted, required when provider=openai | Chat + embeddings credential. |
| `GEMINI_API_KEY` | user-prompted, required when provider=gemini | Chat + embeddings credential. |
| `OPENCLAW_GATEWAY_TOKEN` | `${{secret(64)}}` | Auth for Control UI, WS, `/tools/invoke`. |
| `OPENCLAW_HOOKS_TOKEN` | `${{secret(64)}}` | Shared secret for inbound `/hooks/*` POSTs. |
| `GOG_KEYRING_PASSWORD` | `${{secret(32)}}` | Encrypts persisted provider credentials. Must stay stable across deploys. |
| `PORT` | `18789` | Gateway listener; Railway may override. |
| `XDG_CONFIG_HOME` | `/data/.openclaw` | Redirects OpenClaw state into the volume. |
| `OPENCLAW_REONBOARD` | unset | Set to `1` to force re-onboarding next boot (e.g. rotated API key). |

### Volume

One mount: `/data`, large enough for model artifacts if the user ever enables local embeddings later (200 MB is plenty for the provider-backed default).

### `README.md`

Structure:

1. Title + one-line description + prominent `Deploy on Railway` button.
2. What this deploys (service, volume, public domain, auto-secrets).
3. What you must supply (`OPENCLAW_PROVIDER` + one API key).
4. After deploy: open the public domain, paste the gateway token from Railway Variables, you're in.
5. Webhook verification curl (`401` unauthenticated, authenticated form).
6. How to change provider / rotate keys (set `OPENCLAW_REONBOARD=1`, redeploy, unset).
7. What's explicitly not included (Tailscale, Index Network plugin preinstall, etc.).
8. Link back to upstream OpenClaw docs.

## Security boundaries

### Enforced by the template

- Token auth on the gateway (`mode: "token"`, 64-char random secret, built-in rate limiter).
- Separate hooks token (64-char random secret). Rotating one does not break the other.
- `controlUi.allowedOrigins` locked to the Railway public domain; CORS rejects other origins.
- `allowRequestSessionKey: false` — callers cannot inject session keys.
- `allowedSessionKeyPrefixes: ["hook:"]` — narrow namespace for webhook-driven sessions.
- `GOG_KEYRING_PASSWORD` generated and pinned; persisted credentials on disk are encrypted.
- Plugin load path constrained to `/data/.openclaw/plugins`; no load from arbitrary filesystem locations.

### Permissive by design

- `plugins.enabled: true` with empty allow/deny lists — users can install any plugin post-deploy.
- `hooks.mappings: []` — no preconfigured routes. Users add mappings post-deploy. Empty mappings does not mean insecure: every inbound POST still passes the hooks token check.
- `tools.deny: []` — the `/tools/invoke` HTTP surface inherits OpenClaw's built-in default deny list.
- No IP allowlist — this is a public Railway deploy; reachability is the goal.

## Testing strategy

1. **Static checks.** `railway.toml` validates against `https://railway.com/railway.schema.json`. `hadolint Dockerfile` in CI.
2. **Entrypoint smoke test.** Local `docker build` + `docker run` with `OPENCLAW_PROVIDER=openai`, a dummy `OPENAI_API_KEY`, a temp bind-mount for `/data`. Assertions:
   - entrypoint renders `config.json5` without errors,
   - gateway starts listening on `0.0.0.0:18789`,
   - second run with the same volume does not re-onboard (marker file honored),
   - run with `OPENCLAW_REONBOARD=1` does re-onboard.
3. **Live Railway deploy.** One manual deploy during implementation — verify public domain responds on the gateway port, Control UI loads, webhook curl returns `401` without the token and `200`-ish with it.
4. **README link check.** CI verifies the `Deploy on Railway` button href resolves.

No unit test harness, no fake provider. The template's surface is so thin that any bug shows up in step 2 immediately.

## Repo layout

```
openclaw-for-railway/
├── Dockerfile
├── entrypoint.sh
├── config.json5.template
├── railway.toml
├── README.md
├── LICENSE
├── .github/
│   └── workflows/
│       └── ci.yml             # hadolint + toml-schema + readme link check
└── docs/
    └── superpowers/
        ├── specs/2026-04-11-openclaw-for-railway-design.md
        └── plans/2026-04-11-openclaw-for-railway.md
```

## Risks and mitigations

- **Assumption: `openclaw onboard` writes provider credentials to a file separate from `config.json5`.** If onboarding in fact writes to the same file, it would clobber the envsubst-rendered gateway section on first boot. Mitigation: run onboarding *before* the envsubst render (already the order in `entrypoint.sh`), so our template is the last writer and wins.
- **Assumption: empty `${OPENCLAW_PROVIDER}` substitution in `memorySearch.provider` is a valid "auto-detect" for OpenClaw.** If not, the rendered file fails validation on deploys where the user hasn't set a provider yet. Mitigation: the entrypoint can detect an unset provider and post-process `memorySearch` out of the rendered file with `sed`; or we emit the block only when provider is set. Verify during the smoke test.
- **Image drift.** `openclaw/openclaw:latest` changes upstream. If a new release breaks CLI flags or config keys, the template silently regresses. Mitigation: CI pulls `openclaw/openclaw:latest` on a weekly cron and runs the smoke test. Pin via a tag later if churn becomes a problem.
- **`GOG_KEYRING_PASSWORD` rotation.** A user who regenerates the value in the Railway dashboard will brick their keyring. Mitigation: README spells this out clearly.
- **Railway template-variable prompts.** The `${{secret(n)}}` functions live in the Railway dashboard template form, not in `railway.toml`. The repo cannot fully guarantee the user will see the right prompts unless the template is registered with the dashboard. Mitigation: implementation plan includes manual template-dashboard publishing step.

## Verification (definition of done)

- Clicking the README deploy button on a fresh Railway account produces a running service with a public domain.
- The Control UI loads on the public domain and accepts the auto-generated gateway token.
- `curl -X POST https://<domain>/hooks/ping` returns `401` without a token.
- The provider picked at deploy time is active in OpenClaw; memory/semantic search reports the matching embedding provider.
- Redeploy without changing variables does not re-onboard the provider.
- README, `railway.toml`, and the smoke test all pass CI.
