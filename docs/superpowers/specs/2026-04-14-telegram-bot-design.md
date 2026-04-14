# Telegram Bot Integration — Design Spec

**Date:** 2026-04-14
**Status:** Approved

## Overview

Add Telegram as a notification and chat channel. A shared Index Telegram bot (configured via BotFather) serves two roles:

1. **Notification push** — event-driven messages to users (new accepted opportunity by default; negotiation turn opt-in)
2. **Chat gateway** — users send messages to the bot and receive responses from the Index Chat Orchestrator graph, identically to the web chat and MCP gateways

All Telegram message delivery — whether a chat reply or a system notification — flows through the **Telegram gateway**, which is the single point of Bot API interaction. Every outbound message is written to the user's Telegram conversation so the full history is available in the web app.

A Linear issue (IND-232) tracks a follow-up to formally rename `chat.controller.ts` and `mcp.handler.ts` as gateways and introduce a `gateways/` directory.

---

## Architecture

### Components

| Component | Location | Role |
|---|---|---|
| Connect/disconnect endpoints | `IntegrationController` + `IntegrationService` | User-facing setup, deep link generation, prefs write |
| One-time connect tokens | Redis (`telegram:connect:<token>` → userId) | Bridge Index userId to incoming Telegram chatId |
| Telegram gateway | `backend/src/gateways/telegram.gateway.ts` | Single point of Bot API delivery; handles inbound chat + outbound notifications |
| Bot API helper | `backend/src/lib/telegram/bot-api.ts` | Thin HTTP wrapper: `sendMessage`, `editMessage`, `setWebhook`, `answerCallbackQuery` |
| Notification event | `backend/src/lib/notification-events.ts` | Extended with `emitTelegramNotification` / `onTelegramNotification` |
| Notification delivery | `backend/src/queues/notification.queue.ts` | Extended with Telegram branch in opportunity handler + new negotiation job type |
| NegotiationEvents wiring | `backend/src/main.ts` | Wire `onTurnReceived` / `onCompleted` to enqueue negotiation notification jobs |

### Gateway concept

The Telegram gateway is the third chat gateway alongside web chat (`chat.controller.ts`) and MCP (`mcp.handler.ts`). All three accept user input from different transports and route to the same `ChatSessionService` / chat graph. The gateway also owns outbound delivery for notifications, ensuring everything is recorded in the conversation system.

### Message flow — inbound (user → bot)

```
Telegram webhook POST /webhooks/telegram
  → telegram.gateway.ts handleInbound(chatId, text)
    → look up userId + sessionId from prefs.telegram
    → unknown chatId? → reply "Please connect your account at index.network"
    → ChatSessionService.processMessage(userId, text, sessionId)
      [accumulates streamed response into single string]
    → bot-api.ts sendMessage(chatId, response)
    [conversation already written by ChatSessionService]
```

### Message flow — outbound (notification → bot)

```
NotificationQueue processes job
  → checks prefs.telegram exists + notification pref enabled
  → emitTelegramNotification({ userId, message, inlineButtons? })
    → telegram.gateway.ts handleOutbound({ userId, message, inlineButtons? })
      → look up chatId + sessionId from prefs.telegram
      → sessionId missing? → create conversation via ConversationDatabaseAdapter → write sessionId to prefs
      → bot-api.ts sendMessage(chatId, message, inlineButtons?)
      → ConversationDatabaseAdapter.createMessage(sessionId, role: 'assistant', content: message)
```

### Streaming

The chat graph streams responses. The Telegram gateway collects the full stream before sending (one `sendMessage` call). Progressive delivery via `editMessage` is a future enhancement tracked separately.

---

## Data Model

No new database tables. All Telegram state lives in the existing `prefs` JSONB column on `users`.

### `prefs.telegram` shape

```typescript
interface TelegramPrefs {
  chatId: string;         // Telegram chat ID captured at /start
  sessionId: string;      // Conversation ID in the existing conversation system
  connectedAt: string;    // ISO timestamp
  notifications: {
    opportunityAccepted: boolean;  // default: true
    negotiationTurn: boolean;      // default: false
  };
}
```

### One-time connect tokens

Redis key: `telegram:connect:<token>` → `userId`
TTL: 15 minutes
No migration required.

---

## Connection Flow

1. User calls `POST /api/integrations/connect/telegram` (authenticated)
2. `IntegrationService.connectTelegram(userId)` generates a cryptographically random token, stores it in Redis, returns `{ deepLink: "https://t.me/<BOT_USERNAME>?start=<token>" }`
3. User clicks the deep link — Telegram opens the bot and sends `/start <token>`
4. Bot webhook (`POST /webhooks/telegram`) receives the update
5. Gateway validates token → retrieves `userId` from Redis → stores `{ chatId, connectedAt, notifications: { opportunityAccepted: true, negotiationTurn: false } }` in `prefs.telegram` → deletes token → replies "Connected! You'll receive notifications here."
6. User calls `DELETE /api/integrations/telegram` → `IntegrationService.disconnectTelegram(userId)` clears `prefs.telegram`

`IntegrationController.list()` is extended to include a synthetic Telegram connection entry when `prefs.telegram` is set, so Telegram appears alongside Gmail/Slack connections in the UI.

---

## Integration Setup (IntegrationController / IntegrationService)

- `ALLOWED_TOOLKITS` in `IntegrationController` gains `'telegram'`
- Telegram routes bypass the Composio `IntegrationAdapter` — handled by new methods on `IntegrationService` directly:
  - `connectTelegram(userId): Promise<{ deepLink: string }>`
  - `disconnectTelegram(userId): Promise<void>`
- `listConnections(userId)` merges Composio connections with a synthetic Telegram entry from `prefs`

---

## Notification Delivery

### Opportunity notifications (`NotificationQueue`)

`processOpportunityNotification` gains a Telegram branch after the existing WebSocket/email/digest logic:

```
if prefs.telegram && prefs.telegram.notifications.opportunityAccepted:
  emitTelegramNotification({
    userId,
    message: "New connection: <summary>",
    inlineButtons: [{ text: "View", url: "https://index.network/opportunities/<id>" }]
  })
```

### Negotiation notifications (new job type)

New job name: `process_negotiation_notification`
Job data: `{ negotiationId, recipientId, turnNumber, counterpartyAction }`

Enqueued from `main.ts` by wiring `NegotiationEvents.onTurnReceived`:

```typescript
NegotiationEvents.onTurnReceived = (data) => {
  notificationQueue.queue.add('process_negotiation_notification', {
    negotiationId: data.negotiationId,
    recipientId: data.userId,
    turnNumber: data.turnNumber,
    counterpartyAction: data.counterpartyAction,
  });
};
```

Delivery checks `prefs.telegram.notifications.negotiationTurn` before emitting.

---

## Gateway — Webhook Endpoint

`POST /webhooks/telegram` — registered in a new `WebhooksController` (not Telegram-specific; future webhooks from other services register here too).

The endpoint validates the request using the `X-Telegram-Bot-Api-Secret-Token` header (set when calling `setWebhook`), then delegates to the Telegram gateway.

**Update types handled:**

| Type | Handler |
|---|---|
| Message with text starting `/start <token>` | Complete connection flow |
| Message with any other text | Route to `ChatSessionService`, reply with response |
| Message from unknown chatId | Reply "Please connect your account at index.network" |
| `callback_query` | Reserved for future inline button actions |

---

## Error Handling

| Scenario | Handling |
|---|---|
| Bot API send fails (network, bot blocked/kicked) | Notification jobs: propagate error → `NotificationQueue` retries 3× with exponential backoff. Chat replies: log + skip. |
| `/start` with expired or unknown token | Reply: "This link has expired. Please reconnect from Index." |
| Inbound message from unknown `chatId` | Reply: "Please connect your account at index.network first." |
| User disconnects Telegram | `prefs.telegram` cleared → notification branch skips → inbound gets unknown chatId reply |
| Session creation fails on first notification | Log error, still send Telegram message (delivery over recording) |
| `NegotiationEvents` hook throws | Caught in `main.ts` wiring, logged, job not enqueued (notifications non-critical) |

---

## Environment Variables

| Variable | Purpose |
|---|---|
| `TELEGRAM_BOT_TOKEN` | Bot token from BotFather |
| `TELEGRAM_BOT_USERNAME` | Bot username for deep link generation (e.g. `IndexBot`) |
| `TELEGRAM_WEBHOOK_SECRET` | Secret token for webhook request validation |

---

## Testing

- **`IntegrationService`** — `connectTelegram` generates Redis token + returns deep link; `disconnectTelegram` clears `prefs.telegram`; `listConnections` includes synthetic Telegram entry when connected
- **`NotificationQueue`** — Telegram branch fires when `prefs.telegram` present + pref enabled; skips when disconnected; skips when pref disabled
- **Gateway inbound** — unknown chatId gets redirect reply; known chatId routes to `ChatSessionService` + writes to conversation; `/start <token>` completes connection
- **Gateway outbound** — message sent via Bot API + written as assistant message; session created lazily if missing; Bot API failure propagates for queue retry
- **Connect flow** — token generation → `/start` → `prefs.telegram` populated with `chatId` + default notification prefs

---

## Out of Scope

- Progressive message streaming via `editMessage` (future)
- `callback_query` / inline button action handling beyond URL buttons (future)
- Per-network Telegram notification configuration (future)
- Renaming `chat.controller.ts` / `mcp.handler.ts` as gateways (tracked in IND-232)
