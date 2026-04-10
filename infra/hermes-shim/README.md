# Hermes webhook shim

A single-purpose Caddy reverse proxy that fronts a local [Hermes Agent](https://hermes-agent.nousresearch.com/) gateway, renaming Index Network webhook headers to the GitHub-compatible names Hermes expects.

## Why this exists

Hermes's built-in generic webhook adapter recognises only these signature header conventions:

- GitHub: `X-Hub-Signature-256: sha256=<hex>`
- GitLab: `X-Gitlab-Token: <plain secret>`
- Generic: `X-Webhook-Signature: <raw hex>`

Index Network emits `X-Index-Signature: sha256=<hex>` and `X-Index-Event: <name>`. Algorithm identical to GitHub's; header names different. This shim renames the headers without touching body bytes or the signature value, so Hermes's GitHub validator accepts the payload unchanged.

## Requirements

- A host reachable from the public internet (IPv4 or IPv6) — Index Network needs to POST to it
- Caddy v2+ installed (see https://caddyserver.com/docs/install)
- Hermes Agent running locally on the same host, listening on port 8644 (Hermes's webhook adapter default)

## Setup

1. Install Caddy: follow your distro's package manager instructions, or `curl https://get.caddyserver.com | sh`.

2. Copy the `Caddyfile` to the host:
   ```bash
   sudo cp Caddyfile /etc/caddy/Caddyfile
   ```

3. Edit `/etc/caddy/Caddyfile` and replace `hermes.example.com` with the actual public hostname. If you are only reachable via IPv6, you can use `[::]:443` instead of a hostname, but automatic TLS will not work — use `tls internal` for a self-signed cert and skip Let's Encrypt.

4. Enable and start Caddy:
   ```bash
   sudo systemctl enable --now caddy
   sudo systemctl status caddy
   ```

5. Confirm the shim is reachable:
   ```bash
   curl -i https://hermes.example.com/health
   ```
   Expected: `200 OK` with `{"status": "ok", "platform": "webhook"}` (proxied from Hermes).

## Testing the rewrite

Send a synthetic signed POST through the shim and confirm Hermes accepts it. This requires the same `WEBHOOK_SECRET` Hermes is configured with.

```bash
SECRET="your-hermes-webhook-secret"
BODY='{"event":"opportunity.created","timestamp":"2026-04-10T12:00:00.000Z","payload":{}}'
SIG=$(printf '%s' "$BODY" | openssl dgst -sha256 -hmac "$SECRET" | awk '{print $2}')

curl -i -X POST https://hermes.example.com/webhooks/index-network \
  -H "Content-Type: application/json" \
  -H "X-Index-Signature: sha256=$SIG" \
  -H "X-Index-Event: opportunity.created" \
  -H "X-Request-ID: test-delivery-$(date +%s)" \
  -d "$BODY"
```

Expected: `202 Accepted` from Hermes. If you see `401`, either the secret is wrong or the rewrite is not applied (check `/var/log/caddy/hermes-shim.log`).

## Logs

```bash
sudo tail -f /var/log/caddy/hermes-shim.log
```

For Hermes-side logs (what actually happens after the shim accepts the request):

```bash
tail -f ~/.hermes/logs/agent.log ~/.hermes/logs/errors.log
```

## Security notes

- **TLS is non-negotiable in production.** Index Network enforces `https://` for webhook URLs in production. Don't even try plain HTTP.
- **The shim does NOT validate signatures itself.** It only renames headers. Signature validation happens inside Hermes against the raw body. If you skip Caddy and let Index post directly to Hermes, validation fails because Hermes can't find the header it's looking for.
- **Limit the proxied path to `/webhooks/index-network`.** The Caddyfile's `handle` blocks reject other paths. Don't open `/admin`, `/api`, or anything else from Hermes to the public internet.
- **Rate-limit at the Caddy layer** if you expect significant traffic — Hermes also rate-limits but having two layers reduces the blast radius of a runaway retry loop.
- **Keep the Hermes webhook secret out of version control.** It lives in `~/.hermes/.env` on the host, never in this repo.

## Related

- `docs/guides/hermes-integration.md` — end-to-end guide: Index → Caddy → Hermes → Telegram
- `docs/specs/webhooks.md` — the Index Network side of the wire contract
