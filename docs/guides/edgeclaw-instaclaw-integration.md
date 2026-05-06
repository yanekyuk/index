# EdgeClaw × InstaClaw Integration Guide

This guide is for the InstaClaw team. It describes how to provision an Edge City attendee's Index Network account and configure the OpenClaw plugin on their InstaClaw instance automatically — no user action required.

---

## Overview

For each EdgeClaw attendee, InstaClaw needs to:

1. Call the Index Network signup endpoint with the attendee's email.
2. Receive back an `apiKey` and `agentId`.
3. Write those values into the attendee's OpenClaw plugin config.

That's it. The attendee's agent is then live and connected to the Edge City network.

---

## Step 1 — Call the signup endpoint

```
POST https://index.network/api/networks/<EDGE_CITY_NETWORK_ID>/signup
```

**Authentication:** Master API key in the `x-api-key` header. This key is shared with InstaClaw out of band.

**Request body:**
```json
{ "email": "attendee@example.com" }
```

**Response (201 on first signup, 200 on repeat):**
```json
{
  "user": {
    "id": "user-uuid",
    "email": "attendee@example.com"
  },
  "apiKey": "sk_live_...",
  "agentId": "agent-uuid",
  "connectCommand": "openclaw index connect --api-key sk_live_...",
  "created": true
}
```

| Field | Description |
|-------|-------------|
| `apiKey` | The attendee's personal agent API key. Used to authenticate against the Index Network MCP server. |
| `agentId` | The attendee's personal agent UUID. Required in the plugin config. |
| `connectCommand` | Pre-built CLI command for self-hosted OpenClaw users. InstaClaw can ignore this. |
| `created` | `true` if a new account was created, `false` if the attendee already existed. |

**Idempotent:** Calling this endpoint more than once for the same email always returns the same user. A fresh API key is issued on every call — store the latest one.

---

## Step 2 — Configure the plugin on the attendee's instance

Write the following keys into the attendee's OpenClaw config under `plugins.entries.indexnetwork-openclaw-plugin.config`:

| Config key | Value |
|------------|-------|
| `url` | `https://index.network` |
| `apiKey` | Value of `apiKey` from the signup response |
| `agentId` | Value of `agentId` from the signup response |

**Full config path:** `plugins.entries.indexnetwork-openclaw-plugin.config`

**Example resulting structure in `openclaw.json`:**
```json
{
  "plugins": {
    "entries": {
      "indexnetwork-openclaw-plugin": {
        "config": {
          "url": "https://index.network",
          "apiKey": "sk_live_...",
          "agentId": "agent-uuid"
        }
      }
    }
  }
}
```

The plugin reads these three keys on startup. Once written, the plugin connects automatically — no gateway restart needed if config is injected before the instance starts.

---

## Error handling

| HTTP status | Meaning |
|-------------|---------|
| `200` | Attendee already exists — `apiKey` is a freshly issued key for the existing account |
| `201` | New attendee created |
| `400` | Missing or invalid email |
| `401` | Invalid or missing master API key |
| `500` | Internal error — retry with backoff |

---

## Questions

Contact the Index Network team on the shared channel. Provide the `EDGE_CITY_NETWORK_ID` and the master API key over a secure channel before the event.
