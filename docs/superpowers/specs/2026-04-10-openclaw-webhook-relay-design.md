# OpenClaw Webhook Relay

**Date:** 2026-04-10
**Scope:** `webhooks/openclaw/` (new Rust project), `backend/src/` (MCP instructions field)

## Problem

Index Network personal agents receive negotiation events via webhook delivery. InstaClaw VMs running OpenClaw do not expose a public webhook URL by default, so negotiation turns never reach the agent. OpenClaw is already connected to Index Network via MCP and can act on behalf of the user — it just has no inbound door.

## Goal

A lightweight, always-on Rust HTTP server that runs as a systemd service on the InstaClaw VM, receives signed webhook events from Index Network, deduplicates them, and forwards relevant negotiation events to the local OpenClaw agent via `openclaw agent --message`. The Index Network MCP `instructions` field guides OpenClaw through the full setup autonomously — the user only needs to paste a single prompt to install the MCP.

## Non-Goals

- No persistent storage or queue (Index Network retries on non-2xx)
- No TLS termination (InstaClaw provides networking; relay runs on plain HTTP internally)
- No event handling beyond forwarding to OpenClaw (no direct LLM calls, no direct Index API calls from Rust)
- No support for runtimes other than OpenClaw/InstaClaw

## Design

### 1. Project location

```
index/
└── webhooks/
    └── openclaw/       # Rust binary project
        ├── Cargo.toml
        ├── src/
        │   └── main.rs
        └── README.md
```

Not a subtree, not published to npm. A standalone Rust binary tracked in the monorepo.

### 2. Stack

| Crate | Purpose |
|-------|---------|
| `axum` | HTTP server |
| `tokio` | Async runtime |
| `hmac` + `sha2` | HMAC-SHA256 signature verification |
| `serde` + `serde_json` | JSON parsing |
| `dashmap` | Thread-safe in-memory dedup seen-set |
| `hex` | Hex decode of signature header |

Build target: `x86_64-unknown-linux-musl` (statically linked, no libc dependency).

### 3. Request handling flow

Single route: `POST /index/webhook`

1. Read raw body bytes (must precede JSON parsing — HMAC is over raw bytes)
2. Extract `X-Index-Signature` header; parse `sha256=<hex>` prefix; return `400` if malformed
3. Compute HMAC-SHA256 over raw body with `INDEX_WEBHOOK_SECRET`; compare in constant time via `subtle::ConstantTimeEq`; return `401` on mismatch
4. Check dedup seen-set: if this exact signature was seen within the last 5 minutes, return `200` immediately (idempotent — prevents double-trigger on BullMQ retries)
5. Parse JSON as `{ event: string, timestamp: string, payload: object }`; return `400` on parse failure
6. Filter: act only on `negotiation.started`, `negotiation.turn_received`, `negotiation.completed` — log and return `200` for all other events
7. Build structured prompt string from event fields (see Section 4)
8. Spawn `openclaw agent --message "<prompt>"` as a background subprocess — do **not** await completion; return `200` immediately so Index does not retry
9. Insert signature into dedup seen-set with 5-minute TTL

### 4. Prompt format

```
Index Network event received.

Event: {event}
Timestamp: {timestamp}
Negotiation ID: {payload.negotiation_id}
{if payload.message} Message: {payload.message} {/if}
{if payload.opportunity_id} Opportunity ID: {payload.opportunity_id} {/if}

You have the Index MCP tools available. Review the negotiation state and take the appropriate next action.
```

Fields are extracted from `payload` with graceful fallback (missing fields are omitted, not errors).

### 5. Environment variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `INDEX_WEBHOOK_SECRET` | yes | — | HMAC signing secret (must match the secret stored in `agent_transports.config.secret`) |
| `PORT` | no | `3000` | Port to bind |

### 6. Network binding

The server binds to `[::]:PORT` (IPv6 wildcard) to accept both IPv4 and IPv6 connections. InstaClaw VMs expose a public IPv6 address (`curl -6 ifconfig.me`). The webhook URL registered in Index Network uses bracket notation: `http://[<ipv6>]:3000/index/webhook`.

### 7. Deployment: systemd service

The MCP instructions guide OpenClaw to create `/etc/systemd/system/index-webhook.service`:

```ini
[Unit]
Description=Index Network webhook relay for OpenClaw
After=network.target

[Service]
EnvironmentFile=/etc/index-webhook.env
ExecStart=/usr/local/bin/index-webhook
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
```

`/etc/index-webhook.env`:
```
INDEX_WEBHOOK_SECRET=<generated-or-user-supplied>
PORT=3000
```

### 8. Binary distribution

The binary is uploaded to GitHub Releases (`indexnetwork/index`) tagged as `webhooks/openclaw/v*.*.*`. The MCP instructions reference the latest release download URL for `x86_64-unknown-linux-musl`.

### 9. MCP `instructions` field (onboarding)

The Index Network MCP server's `instructions` field includes an InstaClaw-specific setup block. This is the first thing OpenClaw reads when the MCP is installed. Content:

```
If you are an OpenClaw agent running on an InstaClaw VM, complete the following setup before using any Index tools:

1. Download the webhook relay binary:
   curl -L https://github.com/indexnetwork/index/releases/latest/download/index-webhook-x86_64-unknown-linux-musl -o /usr/local/bin/index-webhook
   chmod +x /usr/local/bin/index-webhook

2. Generate a webhook secret and write the env file:
   SECRET=$(openssl rand -hex 32)
   echo "INDEX_WEBHOOK_SECRET=$SECRET" > /etc/index-webhook.env
   echo "PORT=3000" >> /etc/index-webhook.env

3. Install and start the systemd service:
   [write unit file as shown in spec]
   systemctl daemon-reload
   systemctl enable --now index-webhook

4. Get your public IPv6 address:
   curl -6 ifconfig.me

5. Register yourself as an agent on Index Network:
   Call register_agent with:
   - name: "OpenClaw Agent"
   - transport: webhook
   - url: http://[<your-ipv6>]:3000/index/webhook
   - secret: <the value of $SECRET from step 2>
   - permissions: ["manage:negotiations"]

Setup is complete. You can now receive negotiation events.
```

### 10. User-facing copy prompt

The only thing the user needs to paste into OpenClaw to bootstrap the entire setup:

```
Install the Index Network MCP at <mcp-url> using API key <api-key>. Follow the setup instructions included in the MCP.
```

`<mcp-url>` and `<api-key>` are filled in per-user (shown in the Index Network frontend on the agent setup page).

## File changes

| Area | Path | Change |
|------|------|--------|
| New Rust project | `webhooks/openclaw/` | Webhook relay binary |
| MCP instructions | `backend/src/` (MCP server init) | Add InstaClaw setup block to `instructions` field |
| Frontend (future) | Agent setup page | Show MCP URL + copy prompt with user's API key pre-filled |
