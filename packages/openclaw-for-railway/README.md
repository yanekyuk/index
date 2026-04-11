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

```
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
