# Telegram Bot Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Telegram bot to Index that sends configurable event-driven notifications to users and routes messages to the existing chat graph, with all messages written to conversations.

**Architecture:** Telegram state (chatId, sessionId, notification prefs) is stored as `prefs.telegram` in the `user_notification_settings.preferences` JSONB column — no new tables. A `TelegramGateway` module owns all message delivery (both chat replies and notifications); the `NotificationQueue` emits events, the gateway delivers them and writes to conversations. The `IntegrationController/Service` handles connect/disconnect alongside Gmail/Slack.

**Tech Stack:** Bun, TypeScript, Telegram Bot API (raw HTTP fetch), BullMQ, Drizzle ORM, Redis (ioredis), `bun:test`

---

## File Map

**New files:**
- `backend/src/lib/telegram/bot-api.ts` — Stateless HTTP wrapper for Telegram Bot API
- `backend/src/lib/telegram/tests/bot-api.spec.ts`
- `backend/src/gateways/telegram.gateway.ts` — Single point of Telegram delivery (inbound chat + outbound notifications)
- `backend/src/gateways/tests/telegram.gateway.spec.ts`
- `backend/src/controllers/webhooks.controller.ts` — `POST /webhooks/telegram`

**Modified files:**
- `backend/src/schemas/database.schema.ts` — Extend `NotificationPreferences` with `telegram?: TelegramPrefs`; export `TelegramPrefs` interface
- `backend/src/adapters/database.adapter.ts` — Add `getTelegramPrefs`, `updateTelegramPrefs`, `clearTelegramPrefs`, `findByTelegramChatId` to `UserDatabaseAdapter`
- `backend/src/lib/notification-events.ts` — Add `TelegramNotificationPayload`, `emitTelegramNotification`, `onTelegramNotification`
- `backend/src/queues/notification.queue.ts` — Add Telegram branch to `processOpportunityNotification`; add `process_negotiation_notification` job type
- `backend/src/queues/tests/notification.queue.spec.ts` — Extend existing tests
- `backend/src/services/integration.service.ts` — Add `connectTelegram`, `disconnectTelegram`; extend `listConnections`
- `backend/src/services/tests/integration.service.telegram.spec.ts` — New test file
- `backend/src/controllers/integration.controller.ts` — Add `'telegram'` to allowed toolkits; route telegram connect/disconnect
- `backend/src/main.ts` — Register `WebhooksController`; wire `NegotiationEvents`; call `setWebhook` + `telegramGateway.init()` on startup
- `backend/env.example` — Add `TELEGRAM_BOT_TOKEN`, `TELEGRAM_BOT_USERNAME`, `TELEGRAM_WEBHOOK_SECRET`

---

## Task 1: Extend schema + add DB adapter methods

**Files:**
- Modify: `backend/src/schemas/database.schema.ts`
- Modify: `backend/src/adapters/database.adapter.ts` (UserDatabaseAdapter, lines ~4203–4755)

- [ ] **Step 1: Extend `NotificationPreferences` in the schema**

In `backend/src/schemas/database.schema.ts`, replace the existing `NotificationPreferences` interface (lines 32–35):

```typescript
export interface TelegramPrefs {
  chatId: string;
  sessionId?: string;       // lazily created on first outbound message
  connectedAt: string;      // ISO timestamp
  notifications: {
    opportunityAccepted: boolean;
    negotiationTurn: boolean;
  };
}

export interface NotificationPreferences {
  connectionUpdates: boolean;
  weeklyNewsletter: boolean;
  telegram?: TelegramPrefs;
}
```

- [ ] **Step 2: Add Telegram methods to `UserDatabaseAdapter`**

In `backend/src/adapters/database.adapter.ts`, add the following four methods to `UserDatabaseAdapter` (just before the closing `}` of the class, before the singleton export at line ~4755):

```typescript
/**
 * Get the stored Telegram connection prefs for a user.
 * Returns null when the user has no Telegram connection.
 */
async getTelegramPrefs(userId: string): Promise<TelegramPrefs | null> {
  const result = await db
    .select({ preferences: userNotificationSettings.preferences })
    .from(userNotificationSettings)
    .where(eq(userNotificationSettings.userId, userId))
    .limit(1);
  return (result[0]?.preferences as NotificationPreferences | undefined)?.telegram ?? null;
}

/**
 * Upsert the telegram key inside user_notification_settings.preferences,
 * preserving existing connectionUpdates / weeklyNewsletter values.
 */
async updateTelegramPrefs(userId: string, telegramPrefs: TelegramPrefs): Promise<void> {
  const existing = await db
    .select({ preferences: userNotificationSettings.preferences })
    .from(userNotificationSettings)
    .where(eq(userNotificationSettings.userId, userId))
    .limit(1);
  const current = (existing[0]?.preferences as NotificationPreferences | undefined) ?? {
    connectionUpdates: true,
    weeklyNewsletter: true,
  };
  const updated: NotificationPreferences = { ...current, telegram: telegramPrefs };
  await db
    .insert(userNotificationSettings)
    .values({ userId, preferences: updated })
    .onConflictDoUpdate({
      target: userNotificationSettings.userId,
      set: { preferences: updated, updatedAt: new Date() },
    });
}

/**
 * Remove the telegram key from user_notification_settings.preferences.
 * No-op if the user has no notification settings row.
 */
async clearTelegramPrefs(userId: string): Promise<void> {
  const existing = await db
    .select({ preferences: userNotificationSettings.preferences })
    .from(userNotificationSettings)
    .where(eq(userNotificationSettings.userId, userId))
    .limit(1);
  if (!existing[0]) return;
  const { telegram: _removed, ...rest } = (existing[0].preferences as NotificationPreferences) ?? {};
  await db
    .update(userNotificationSettings)
    .set({ preferences: rest as NotificationPreferences, updatedAt: new Date() })
    .where(eq(userNotificationSettings.userId, userId));
}

/**
 * Find a user by their stored Telegram chatId.
 * Used by the gateway to route inbound messages.
 */
async findByTelegramChatId(chatId: string): Promise<{ userId: string; sessionId?: string } | null> {
  const result = await db
    .select({
      userId: userNotificationSettings.userId,
      preferences: userNotificationSettings.preferences,
    })
    .from(userNotificationSettings)
    .where(sql`${userNotificationSettings.preferences}->'telegram'->>'chatId' = ${chatId}`)
    .limit(1);
  if (!result[0]) return null;
  const telegram = (result[0].preferences as NotificationPreferences | undefined)?.telegram;
  return { userId: result[0].userId, sessionId: telegram?.sessionId };
}
```

Make sure `TelegramPrefs` and `NotificationPreferences` are imported from `'../schemas/database.schema'` at the top of `database.adapter.ts` (add to existing schema imports).

- [ ] **Step 3: Verify TypeScript compiles**

```bash
cd backend && bun run lint
```

Expected: no errors related to the new types.

- [ ] **Step 4: Commit**

```bash
git add backend/src/schemas/database.schema.ts backend/src/adapters/database.adapter.ts
git -c commit.gpgsign=false commit -m "feat(telegram): extend NotificationPreferences schema and add UserDatabaseAdapter telegram methods"
```

---

## Task 2: Bot API helper

**Files:**
- Create: `backend/src/lib/telegram/bot-api.ts`
- Create: `backend/src/lib/telegram/tests/bot-api.spec.ts`

- [ ] **Step 1: Write the failing tests**

Create `backend/src/lib/telegram/tests/bot-api.spec.ts`:

```typescript
import { config } from 'dotenv';
config({ path: '.env.test' });

import { describe, it, expect, beforeEach, afterEach, mock } from 'bun:test';

// Must set before importing bot-api
process.env.TELEGRAM_BOT_TOKEN = 'test-token';

import { sendMessage, setWebhook } from '../bot-api';

let fetchCalls: Array<{ url: string; body: unknown }> = [];
const originalFetch = global.fetch;

beforeEach(() => {
  fetchCalls = [];
  global.fetch = mock(async (url: string, opts?: RequestInit) => {
    fetchCalls.push({ url, body: opts?.body ? JSON.parse(opts.body as string) : null });
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  }) as typeof fetch;
});

afterEach(() => {
  global.fetch = originalFetch;
});

describe('sendMessage', () => {
  it('posts to the correct Telegram endpoint with chat_id and text', async () => {
    await sendMessage('123456', 'Hello!');
    expect(fetchCalls).toHaveLength(1);
    expect(fetchCalls[0].url).toContain('/bottest-token/sendMessage');
    expect(fetchCalls[0].body).toMatchObject({ chat_id: '123456', text: 'Hello!' });
  });

  it('includes inline_keyboard when buttons are provided', async () => {
    await sendMessage('123456', 'Check this out', [[{ text: 'View', url: 'https://example.com' }]]);
    expect(fetchCalls[0].body).toMatchObject({
      reply_markup: { inline_keyboard: [[{ text: 'View', url: 'https://example.com' }]] },
    });
  });

  it('throws when the Telegram API returns a non-ok response', async () => {
    global.fetch = mock(async () => new Response('Bad Request', { status: 400 })) as typeof fetch;
    await expect(sendMessage('123456', 'fail')).rejects.toThrow('Telegram sendMessage failed');
  });
});

describe('setWebhook', () => {
  it('posts to setWebhook with url and secret_token', async () => {
    await setWebhook('https://example.com/webhooks/telegram', 'my-secret');
    expect(fetchCalls[0].url).toContain('/bottest-token/setWebhook');
    expect(fetchCalls[0].body).toMatchObject({
      url: 'https://example.com/webhooks/telegram',
      secret_token: 'my-secret',
    });
  });

  it('throws when setWebhook call fails', async () => {
    global.fetch = mock(async () => new Response('Forbidden', { status: 403 })) as typeof fetch;
    await expect(setWebhook('https://example.com/webhooks/telegram', 'secret')).rejects.toThrow('Telegram setWebhook failed');
  });
});
```

- [ ] **Step 2: Run tests — expect failure**

```bash
cd backend && bun test src/lib/telegram/tests/bot-api.spec.ts
```

Expected: `Cannot find module '../bot-api'`

- [ ] **Step 3: Implement the bot-api helper**

Create `backend/src/lib/telegram/bot-api.ts`:

```typescript
const BASE = 'https://api.telegram.org';

function botUrl(method: string): string {
  return `${BASE}/bot${process.env.TELEGRAM_BOT_TOKEN}/${method}`;
}

/**
 * Send a text message to a Telegram chat.
 * @param chatId - Telegram chat ID (string form of the integer ID)
 * @param text - Message text (HTML parse mode enabled)
 * @param inlineKeyboard - Optional URL-button rows: [[{ text, url }], ...]
 */
export async function sendMessage(
  chatId: string,
  text: string,
  inlineKeyboard?: Array<Array<{ text: string; url: string }>>,
): Promise<void> {
  const body: Record<string, unknown> = { chat_id: chatId, text, parse_mode: 'HTML' };
  if (inlineKeyboard) {
    body.reply_markup = { inline_keyboard: inlineKeyboard };
  }
  const res = await fetch(botUrl('sendMessage'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Telegram sendMessage failed: ${err}`);
  }
}

/**
 * Register a webhook URL with Telegram so the bot receives updates via HTTP POST.
 * @param url - The full HTTPS webhook URL
 * @param secretToken - Sent as X-Telegram-Bot-Api-Secret-Token header with each update
 */
export async function setWebhook(url: string, secretToken: string): Promise<void> {
  const res = await fetch(botUrl('setWebhook'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url, secret_token: secretToken }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Telegram setWebhook failed: ${err}`);
  }
}
```

- [ ] **Step 4: Run tests — expect pass**

```bash
cd backend && bun test src/lib/telegram/tests/bot-api.spec.ts
```

Expected: all 5 tests pass.

- [ ] **Step 5: Commit**

```bash
git add backend/src/lib/telegram/
git -c commit.gpgsign=false commit -m "feat(telegram): add bot-api HTTP helper"
```

---

## Task 3: Extend notification events

**Files:**
- Modify: `backend/src/lib/notification-events.ts`

- [ ] **Step 1: Add Telegram event types and emitters**

Append to `backend/src/lib/notification-events.ts` (after the existing `onOpportunityNotification` export):

```typescript
/** Payload emitted when a Telegram notification should be delivered to a user. */
export interface TelegramNotificationPayload {
  userId: string;
  message: string;
  /** Optional URL buttons shown below the message: [{ text, url }] */
  inlineButtons?: Array<{ text: string; url: string }>;
}

export function emitTelegramNotification(payload: TelegramNotificationPayload): void {
  notificationEmitter.emit('telegram', payload);
}

export function onTelegramNotification(
  handler: (payload: TelegramNotificationPayload) => void,
): () => void {
  notificationEmitter.on('telegram', handler);
  return () => notificationEmitter.off('telegram', handler);
}
```

- [ ] **Step 2: Verify no type errors**

```bash
cd backend && bun run lint
```

Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add backend/src/lib/notification-events.ts
git -c commit.gpgsign=false commit -m "feat(telegram): add TelegramNotificationPayload event emitter"
```

---

## Task 4: Telegram gateway — outbound

**Files:**
- Create: `backend/src/gateways/telegram.gateway.ts`
- Create: `backend/src/gateways/tests/telegram.gateway.spec.ts` (outbound section)

- [ ] **Step 1: Write failing tests for `handleOutbound`**

Create `backend/src/gateways/tests/telegram.gateway.spec.ts`:

```typescript
import { config } from 'dotenv';
config({ path: '.env.test' });

import { describe, it, expect, beforeEach } from 'bun:test';
import type { TelegramPrefs } from '../../schemas/database.schema';

// ── Fakes ────────────────────────────────────────────────────────────────────

interface SentMessage { chatId: string; text: string; keyboard?: unknown }

function makeDeps(overrides: Partial<ReturnType<typeof defaultDeps>> = {}) {
  return { ...defaultDeps(), ...overrides };
}

function defaultDeps() {
  const sessions = new Map<string, { id: string; userId: string }>();
  const messages: Array<{ sessionId: string; role: string; content: string }> = [];
  const sent: SentMessage[] = [];
  const telegramPrefs = new Map<string, TelegramPrefs>();
  const chatIdIndex = new Map<string, { userId: string; sessionId?: string }>();

  return {
    sent,
    messages,
    sessions,
    telegramPrefs,
    getTelegramPrefs: async (userId: string) => telegramPrefs.get(userId) ?? null,
    updateTelegramPrefs: async (userId: string, prefs: TelegramPrefs) => { telegramPrefs.set(userId, prefs); },
    findByTelegramChatId: async (chatId: string) => chatIdIndex.get(chatId) ?? null,
    createChatSession: async (data: { id: string; userId: string; title?: string }) => { sessions.set(data.id, data); },
    createChatMessage: async (data: { id: string; sessionId: string; role: string; content: string }) => { messages.push(data); },
    processMessage: async (_userId: string, _text: string) => ({ responseText: 'Hello from Index!' }),
    sendTelegramMessage: async (chatId: string, text: string, keyboard?: unknown) => { sent.push({ chatId, text, keyboard }); },
    seedTelegramUser: (userId: string, prefs: TelegramPrefs) => {
      telegramPrefs.set(userId, prefs);
      chatIdIndex.set(prefs.chatId, { userId, sessionId: prefs.sessionId });
    },
  };
}

// ── Tests: handleOutbound ────────────────────────────────────────────────────

describe('handleOutbound', () => {
  let deps: ReturnType<typeof makeDeps>;

  beforeEach(() => { deps = makeDeps(); });

  it('sends the message and writes it to the existing session', async () => {
    const prefs: TelegramPrefs = {
      chatId: 'chat-1',
      sessionId: 'session-1',
      connectedAt: '2026-04-14T00:00:00Z',
      notifications: { opportunityAccepted: true, negotiationTurn: false },
    };
    deps.seedTelegramUser('user-1', prefs);

    const { handleOutbound } = await import('../telegram.gateway');
    await handleOutbound({ userId: 'user-1', message: 'You have a new match!' }, deps);

    expect(deps.sent).toHaveLength(1);
    expect(deps.sent[0]).toMatchObject({ chatId: 'chat-1', text: 'You have a new match!' });
    expect(deps.messages).toHaveLength(1);
    expect(deps.messages[0]).toMatchObject({ sessionId: 'session-1', role: 'assistant', content: 'You have a new match!' });
  });

  it('creates a session lazily when sessionId is missing', async () => {
    const prefs: TelegramPrefs = {
      chatId: 'chat-2',
      connectedAt: '2026-04-14T00:00:00Z',
      notifications: { opportunityAccepted: true, negotiationTurn: false },
    };
    deps.seedTelegramUser('user-2', prefs);

    const { handleOutbound } = await import('../telegram.gateway');
    await handleOutbound({ userId: 'user-2', message: 'Hello!' }, deps);

    expect(deps.sessions.size).toBe(1);
    const [session] = [...deps.sessions.values()];
    expect(session.userId).toBe('user-2');
    expect(deps.messages[0].sessionId).toBe(session.id);
    // prefs updated with new sessionId
    expect(deps.telegramPrefs.get('user-2')?.sessionId).toBe(session.id);
  });

  it('logs and returns silently when user has no Telegram connection', async () => {
    const { handleOutbound } = await import('../telegram.gateway');
    await handleOutbound({ userId: 'ghost-user', message: 'test' }, deps);
    expect(deps.sent).toHaveLength(0);
  });

  it('passes inline buttons to sendTelegramMessage', async () => {
    const prefs: TelegramPrefs = {
      chatId: 'chat-3',
      sessionId: 'session-3',
      connectedAt: '2026-04-14T00:00:00Z',
      notifications: { opportunityAccepted: true, negotiationTurn: false },
    };
    deps.seedTelegramUser('user-3', prefs);

    const { handleOutbound } = await import('../telegram.gateway');
    await handleOutbound(
      { userId: 'user-3', message: 'New match!', inlineButtons: [{ text: 'View', url: 'https://index.network/o/1' }] },
      deps,
    );

    expect(deps.sent[0].keyboard).toEqual([[{ text: 'View', url: 'https://index.network/o/1' }]]);
  });
});
```

- [ ] **Step 2: Run — expect module-not-found failure**

```bash
cd backend && bun test src/gateways/tests/telegram.gateway.spec.ts 2>&1 | head -20
```

Expected: `Cannot find module '../telegram.gateway'`

- [ ] **Step 3: Implement `handleOutbound` and `init`**

Create `backend/src/gateways/telegram.gateway.ts`:

```typescript
import { log } from '../lib/log';
import { userDatabaseAdapter, conversationDatabaseAdapter } from '../adapters/database.adapter';
import { chatSessionService } from '../services/chat.service';
import { sendMessage } from '../lib/telegram/bot-api';
import { onTelegramNotification, type TelegramNotificationPayload } from '../lib/notification-events';
import type { TelegramPrefs } from '../schemas/database.schema';
import { getRedisClient } from '../adapters/cache.adapter';

const logger = log.from('TelegramGateway');

export const CONNECT_TOKEN_PREFIX = 'telegram:connect:';
export const CONNECT_TOKEN_TTL_SEC = 15 * 60;

// ── Dependency interface (injected in tests, resolved from singletons in prod) ─

export interface GatewayDeps {
  getTelegramPrefs(userId: string): Promise<TelegramPrefs | null>;
  updateTelegramPrefs(userId: string, prefs: TelegramPrefs): Promise<void>;
  findByTelegramChatId(chatId: string): Promise<{ userId: string; sessionId?: string } | null>;
  createChatSession(data: { id: string; userId: string; title?: string }): Promise<void>;
  createChatMessage(data: { id: string; sessionId: string; role: string; content: string }): Promise<void>;
  processMessage(userId: string, text: string): Promise<{ responseText: string; error?: string }>;
  sendTelegramMessage(chatId: string, text: string, keyboard?: Array<Array<{ text: string; url: string }>>): Promise<void>;
}

function productionDeps(): GatewayDeps {
  return {
    getTelegramPrefs: (userId) => userDatabaseAdapter.getTelegramPrefs(userId),
    updateTelegramPrefs: (userId, prefs) => userDatabaseAdapter.updateTelegramPrefs(userId, prefs),
    findByTelegramChatId: (chatId) => userDatabaseAdapter.findByTelegramChatId(chatId),
    createChatSession: (data) => conversationDatabaseAdapter.createChatSession(data),
    createChatMessage: (data) => conversationDatabaseAdapter.createChatMessage(data),
    processMessage: (userId, text) => chatSessionService.processMessage(userId, text),
    sendTelegramMessage: sendMessage,
  };
}

/**
 * Handle a notification event: deliver via Telegram and write to conversation.
 * @param payload - Notification payload from the NotificationQueue
 * @param deps - Injectable deps (defaults to production singletons)
 */
export async function handleOutbound(
  payload: TelegramNotificationPayload,
  deps: GatewayDeps = productionDeps(),
): Promise<void> {
  const currentPrefs = await deps.getTelegramPrefs(payload.userId);
  if (!currentPrefs) {
    logger.warn('Telegram outbound skipped: no connection', { userId: payload.userId });
    return;
  }

  const { chatId } = currentPrefs;
  let { sessionId } = currentPrefs;

  // Create chat session lazily on first notification
  if (!sessionId) {
    sessionId = crypto.randomUUID();
    await deps.createChatSession({ id: sessionId, userId: payload.userId, title: 'Telegram' });
    await deps.updateTelegramPrefs(payload.userId, { ...currentPrefs, sessionId });
  }

  const keyboard = payload.inlineButtons
    ? [payload.inlineButtons.map((b) => ({ text: b.text, url: b.url }))]
    : undefined;

  await deps.sendTelegramMessage(chatId, payload.message, keyboard);

  await deps.createChatMessage({
    id: crypto.randomUUID(),
    sessionId,
    role: 'assistant',
    content: payload.message,
  });
}

/**
 * Subscribe the gateway to Telegram notification events.
 * Call once at startup (from main.ts).
 */
export function init(): void {
  onTelegramNotification((payload) => {
    handleOutbound(payload).catch((err) => {
      logger.error('Telegram outbound delivery failed', { userId: payload.userId, error: err });
    });
  });
}

// handleInbound added in Task 5
```

- [ ] **Step 4: Run outbound tests — expect pass**

```bash
cd backend && bun test src/gateways/tests/telegram.gateway.spec.ts
```

Expected: all 4 `handleOutbound` tests pass.

- [ ] **Step 5: Commit**

```bash
git add backend/src/gateways/
git -c commit.gpgsign=false commit -m "feat(telegram): add TelegramGateway handleOutbound + init"
```

---

## Task 5: Telegram gateway — inbound

**Files:**
- Modify: `backend/src/gateways/telegram.gateway.ts` — add `handleInbound`
- Modify: `backend/src/gateways/tests/telegram.gateway.spec.ts` — add inbound test section

- [ ] **Step 1: Write failing tests for `handleInbound`**

Append to `backend/src/gateways/tests/telegram.gateway.spec.ts`:

```typescript
// ── Tests: handleInbound ─────────────────────────────────────────────────────

describe('handleInbound', () => {
  let deps: ReturnType<typeof makeDeps>;
  let redisFake: Map<string, string>;

  beforeEach(() => {
    deps = makeDeps();
    redisFake = new Map();
  });

  async function callInbound(chatId: string, text: string) {
    const { handleInbound } = await import('../telegram.gateway');
    await handleInbound(chatId, text, deps, {
      get: async (key: string) => redisFake.get(key) ?? null,
      del: async (key: string) => { redisFake.delete(key); },
    });
  }

  it('replies with connect prompt for unknown chatId', async () => {
    await callInbound('unknown-chat', 'hello');
    expect(deps.sent[0].text).toContain('index.network');
  });

  it('routes a known user message to the chat graph and writes to conversation', async () => {
    const prefs: TelegramPrefs = {
      chatId: 'chat-known',
      sessionId: 'sess-1',
      connectedAt: '2026-04-14T00:00:00Z',
      notifications: { opportunityAccepted: true, negotiationTurn: false },
    };
    deps.seedTelegramUser('user-known', prefs);

    await callInbound('chat-known', 'What are my intents?');

    // Sends graph response back
    expect(deps.sent[0]).toMatchObject({ chatId: 'chat-known', text: 'Hello from Index!' });
    // Writes user + assistant messages to conversation
    const userMsg = deps.messages.find((m) => m.role === 'user');
    const assistantMsg = deps.messages.find((m) => m.role === 'assistant');
    expect(userMsg?.content).toBe('What are my intents?');
    expect(assistantMsg?.content).toBe('Hello from Index!');
  });

  it('completes /start <token> flow: stores chatId and confirms', async () => {
    redisFake.set('telegram:connect:valid-token', 'user-new');

    await callInbound('chat-new', '/start valid-token');

    const stored = deps.telegramPrefs.get('user-new');
    expect(stored?.chatId).toBe('chat-new');
    expect(stored?.notifications.opportunityAccepted).toBe(true);
    expect(stored?.notifications.negotiationTurn).toBe(false);
    expect(deps.sent[0].text).toContain('connected');
    // Token consumed
    expect(redisFake.has('telegram:connect:valid-token')).toBe(false);
  });

  it('replies with expired-token message for unknown token', async () => {
    await callInbound('chat-x', '/start bad-token');
    expect(deps.sent[0].text).toContain('expired');
  });
});
```

- [ ] **Step 2: Run — expect failure**

```bash
cd backend && bun test src/gateways/tests/telegram.gateway.spec.ts 2>&1 | grep "handleInbound"
```

Expected: `handleInbound is not a function` or similar.

- [ ] **Step 3: Implement `handleInbound`**

Append to `backend/src/gateways/telegram.gateway.ts` (before the final closing line):

```typescript
// ── Minimal Redis interface needed by handleInbound ────────────────────────

interface RedisReader {
  get(key: string): Promise<string | null>;
  del(key: string): Promise<void>;
}

function productionRedis(): RedisReader {
  const redis = getRedisClient();
  return {
    get: (key) => redis.get(key),
    del: (key) => redis.del(key).then(() => undefined),
  };
}

const UNKNOWN_CHAT_MSG = 'Please connect your Telegram account at index.network first.';
const EXPIRED_TOKEN_MSG = 'This link has expired. Please reconnect from Index.';
const CONNECTED_MSG =
  'Your Telegram account is now connected to Index. You\'ll receive notifications here and can chat with me anytime.';

/**
 * Handle an update received from Telegram (text message or /start command).
 * @param chatId - Sender's Telegram chat ID
 * @param text - Message text
 * @param deps - Injectable deps (defaults to production singletons)
 * @param redis - Injectable Redis reader (defaults to production client)
 */
export async function handleInbound(
  chatId: string,
  text: string,
  deps: GatewayDeps = productionDeps(),
  redis: RedisReader = productionRedis(),
): Promise<void> {
  if (text.startsWith('/start ')) {
    const token = text.slice(7).trim();
    await handleConnectToken(chatId, token, deps, redis);
    return;
  }

  const found = await deps.findByTelegramChatId(chatId);
  if (!found) {
    await deps.sendTelegramMessage(chatId, UNKNOWN_CHAT_MSG);
    return;
  }

  const { userId, sessionId } = found;

  // Write user message to conversation (best-effort)
  if (sessionId) {
    await deps.createChatMessage({
      id: crypto.randomUUID(),
      sessionId,
      role: 'user',
      content: text,
    }).catch((err) => logger.warn('Failed to write user message to conversation', { error: err }));
  }

  // Route to chat graph
  const result = await deps.processMessage(userId, text);
  const responseText = result.responseText || 'Sorry, I could not process your message.';

  // Write assistant response (best-effort)
  if (sessionId) {
    await deps.createChatMessage({
      id: crypto.randomUUID(),
      sessionId,
      role: 'assistant',
      content: responseText,
    }).catch((err) => logger.warn('Failed to write assistant message to conversation', { error: err }));
  }

  await deps.sendTelegramMessage(chatId, responseText);
}

async function handleConnectToken(
  chatId: string,
  token: string,
  deps: GatewayDeps,
  redis: RedisReader,
): Promise<void> {
  const userId = await redis.get(`${CONNECT_TOKEN_PREFIX}${token}`);
  if (!userId) {
    await deps.sendTelegramMessage(chatId, EXPIRED_TOKEN_MSG);
    return;
  }

  await redis.del(`${CONNECT_TOKEN_PREFIX}${token}`);

  const newPrefs: TelegramPrefs = {
    chatId,
    connectedAt: new Date().toISOString(),
    notifications: { opportunityAccepted: true, negotiationTurn: false },
  };
  await deps.updateTelegramPrefs(userId, newPrefs);
  await deps.sendTelegramMessage(chatId, CONNECTED_MSG);
}
```

- [ ] **Step 4: Run all gateway tests — expect pass**

```bash
cd backend && bun test src/gateways/tests/telegram.gateway.spec.ts
```

Expected: all 8 tests pass (4 outbound + 4 inbound).

- [ ] **Step 5: Commit**

```bash
git add backend/src/gateways/telegram.gateway.ts backend/src/gateways/tests/telegram.gateway.spec.ts
git -c commit.gpgsign=false commit -m "feat(telegram): add TelegramGateway handleInbound with /start token flow"
```

---

## Task 6: WebhooksController

**Files:**
- Create: `backend/src/controllers/webhooks.controller.ts`

No test file — the controller is a thin HTTP adapter; the logic is tested in the gateway.

- [ ] **Step 1: Create the controller**

Create `backend/src/controllers/webhooks.controller.ts`:

```typescript
import { Controller, Post } from '../lib/router/router.decorators';
import { handleInbound } from '../gateways/telegram.gateway';
import { log } from '../lib/log';

const logger = log.controller.from('webhooks');

/** Shape of a Telegram Update object (only fields we use). */
interface TelegramUpdate {
  message?: {
    chat: { id: number };
    text?: string;
  };
}

/**
 * General-purpose webhook receiver. Not specific to Telegram — future
 * webhooks from other services can be added here as new routes.
 */
@Controller('/webhooks')
export class WebhooksController {
  /**
   * Receive updates from the Telegram Bot API.
   * Telegram calls this URL for every incoming message.
   * Validated via X-Telegram-Bot-Api-Secret-Token header.
   *
   * POST /webhooks/telegram
   */
  @Post('/telegram')
  async telegram(req: Request): Promise<Response> {
    const secret = req.headers.get('X-Telegram-Bot-Api-Secret-Token');
    if (!secret || secret !== process.env.TELEGRAM_WEBHOOK_SECRET) {
      return new Response('Unauthorized', { status: 401 });
    }

    let body: TelegramUpdate;
    try {
      body = (await req.json()) as TelegramUpdate;
    } catch {
      return new Response('Bad Request', { status: 400 });
    }

    const message = body.message;
    if (message?.text) {
      const chatId = String(message.chat.id);
      handleInbound(chatId, message.text).catch((err) => {
        logger.error('Telegram inbound handling failed', { chatId, error: err });
      });
    }

    // Always respond 200 immediately — Telegram resends if we take too long.
    return new Response('OK', { status: 200 });
  }
}
```

- [ ] **Step 2: Verify no lint errors**

```bash
cd backend && bun run lint
```

- [ ] **Step 3: Commit**

```bash
git add backend/src/controllers/webhooks.controller.ts
git -c commit.gpgsign=false commit -m "feat(telegram): add WebhooksController with POST /webhooks/telegram"
```

---

## Task 7: IntegrationService — Telegram connect/disconnect

**Files:**
- Modify: `backend/src/services/integration.service.ts`
- Create: `backend/src/services/tests/integration.service.telegram.spec.ts`

- [ ] **Step 1: Write failing tests**

Create `backend/src/services/tests/integration.service.telegram.spec.ts`:

```typescript
import { config } from 'dotenv';
config({ path: '.env.test' });

import { describe, it, expect, beforeEach } from 'bun:test';
import { IntegrationService } from '../integration.service';
import type { IntegrationAdapter } from '@indexnetwork/protocol';
import type { TelegramPrefs } from '../../schemas/database.schema';

process.env.TELEGRAM_BOT_USERNAME = 'TestIndexBot';

// ── Fakes ─────────────────────────────────────────────────────────────────

class FakeIntegrationAdapter implements IntegrationAdapter {
  async createSession() { return { tools: async () => [], authorize: async () => ({ redirectUrl: '', waitForConnection: async () => ({}) }), toolkits: async () => ({ items: [] }) }; }
  async executeToolAction() { return { successful: true }; }
  async listConnections() { return []; }
  async getAuthUrl() { return { redirectUrl: '' }; }
  async disconnect() { return { success: true }; }
}

const redisFake = new Map<string, { value: string; ttl: number }>();
const telegramPrefsFake = new Map<string, TelegramPrefs>();

function makeService() {
  const adapter = new FakeIntegrationAdapter();
  const service = new IntegrationService(
    adapter,
    { importContacts: async () => ({ imported: 0, skipped: 0, newContacts: 0, existingContacts: 0, details: [] }), resolveUsers: async () => ({ userIds: [], skipped: 0, details: [] }) },
    undefined,
    {
      set: async (key: string, value: string, _ex: string, ttl: number) => { redisFake.set(key, { value, ttl }); },
      get: async (key: string) => redisFake.get(key)?.value ?? null,
    },
    {
      getTelegramPrefs: async (userId: string) => telegramPrefsFake.get(userId) ?? null,
      updateTelegramPrefs: async (userId: string, prefs: TelegramPrefs) => { telegramPrefsFake.set(userId, prefs); },
      clearTelegramPrefs: async (userId: string) => { telegramPrefsFake.delete(userId); },
    },
  );
  return service;
}

describe('IntegrationService.connectTelegram', () => {
  beforeEach(() => { redisFake.clear(); telegramPrefsFake.clear(); });

  it('returns a deep link with the bot username', async () => {
    const service = makeService();
    const result = await service.connectTelegram('user-1');
    expect(result.deepLink).toContain('t.me/TestIndexBot?start=');
  });

  it('stores the userId in Redis with 15-minute TTL', async () => {
    const service = makeService();
    const { deepLink } = await service.connectTelegram('user-1');
    const token = deepLink.split('start=')[1];
    const stored = redisFake.get(`telegram:connect:${token}`);
    expect(stored?.value).toBe('user-1');
    expect(stored?.ttl).toBe(900);
  });
});

describe('IntegrationService.disconnectTelegram', () => {
  beforeEach(() => { telegramPrefsFake.clear(); });

  it('clears telegram prefs for the user', async () => {
    telegramPrefsFake.set('user-1', {
      chatId: '123',
      connectedAt: '2026-04-14T00:00:00Z',
      notifications: { opportunityAccepted: true, negotiationTurn: false },
    });
    const service = makeService();
    await service.disconnectTelegram('user-1');
    expect(telegramPrefsFake.has('user-1')).toBe(false);
  });
});

describe('IntegrationService.listConnections', () => {
  beforeEach(() => { telegramPrefsFake.clear(); });

  it('returns a synthetic Telegram entry when connected', async () => {
    telegramPrefsFake.set('user-1', {
      chatId: '123',
      connectedAt: '2026-04-14T10:00:00Z',
      notifications: { opportunityAccepted: true, negotiationTurn: false },
    });
    const service = makeService();
    const connections = await service.listConnections('user-1');
    const telegram = connections.find((c) => c.toolkit === 'telegram');
    expect(telegram).toBeDefined();
    expect(telegram?.status).toBe('active');
    expect(telegram?.id).toContain('telegram:');
  });

  it('omits Telegram entry when not connected', async () => {
    const service = makeService();
    const connections = await service.listConnections('user-1');
    expect(connections.find((c) => c.toolkit === 'telegram')).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run — expect failure**

```bash
cd backend && bun test src/services/tests/integration.service.telegram.spec.ts 2>&1 | head -20
```

Expected: `connectTelegram is not a function` or constructor mismatch.

- [ ] **Step 3: Extend `IntegrationService`**

Modify `backend/src/services/integration.service.ts`:

**Add imports** at top:

```typescript
import { getRedisClient } from '../adapters/cache.adapter';
import { userDatabaseAdapter } from '../adapters/database.adapter';
import type { TelegramPrefs } from '../schemas/database.schema';
import type { IntegrationConnection } from '@indexnetwork/protocol';
```

**Add injectable interfaces** after the existing `Toolkit` type:

```typescript
const CONNECT_TOKEN_PREFIX = 'telegram:connect:';
const CONNECT_TOKEN_TTL_SEC = 15 * 60;

interface RedisWriter {
  set(key: string, value: string, ex: string, ttl: number): Promise<void>;
  get(key: string): Promise<string | null>;
}

interface TelegramDb {
  getTelegramPrefs(userId: string): Promise<TelegramPrefs | null>;
  updateTelegramPrefs(userId: string, prefs: TelegramPrefs): Promise<void>;
  clearTelegramPrefs(userId: string): Promise<void>;
}
```

**Extend the constructor** to accept optional injectable deps:

```typescript
constructor(
  private adapter: IntegrationAdapter,
  private contactImporter: ContactImporter,
  db?: ChatDatabaseAdapter,
  private redis: RedisWriter = (() => {
    const r = getRedisClient();
    return {
      set: (key, value, _ex, ttl) => r.set(key, value, 'EX', ttl).then(() => undefined),
      get: (key) => r.get(key),
    };
  })(),
  private telegramDb: TelegramDb = userDatabaseAdapter,
) {
  this.db = db ?? new ChatDatabaseAdapter();
}
```

**Extend `listConnections`:**

```typescript
async listConnections(userId: string): Promise<IntegrationConnection[]> {
  const composioConnections = await this.adapter.listConnections(userId);
  const telegramPrefs = await this.telegramDb.getTelegramPrefs(userId);
  if (!telegramPrefs) return composioConnections;

  const telegramEntry: IntegrationConnection = {
    id: `telegram:${userId}`,
    toolkit: 'telegram',
    status: 'active',
    createdAt: telegramPrefs.connectedAt,
  };
  return [...composioConnections, telegramEntry];
}
```

**Add new methods** before the closing `}` of the class:

```typescript
/**
 * Generate a one-time deep link for connecting a Telegram account.
 * Stores a 15-minute Redis token mapping token → userId.
 */
async connectTelegram(userId: string): Promise<{ deepLink: string }> {
  const token = crypto.randomUUID();
  await this.redis.set(`${CONNECT_TOKEN_PREFIX}${token}`, userId, 'EX', CONNECT_TOKEN_TTL_SEC);
  const botUsername = process.env.TELEGRAM_BOT_USERNAME ?? '';
  return { deepLink: `https://t.me/${botUsername}?start=${token}` };
}

/**
 * Remove the Telegram connection for a user.
 */
async disconnectTelegram(userId: string): Promise<void> {
  await this.telegramDb.clearTelegramPrefs(userId);
  logger.info('Telegram disconnected', { userId });
}
```

- [ ] **Step 4: Run Telegram integration service tests — expect pass**

```bash
cd backend && bun test src/services/tests/integration.service.telegram.spec.ts
```

Expected: all 5 tests pass.

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/integration.service.ts backend/src/services/tests/integration.service.telegram.spec.ts
git -c commit.gpgsign=false commit -m "feat(telegram): add connectTelegram, disconnectTelegram and extend listConnections in IntegrationService"
```

---

## Task 8: IntegrationController — Telegram routing

**Files:**
- Modify: `backend/src/controllers/integration.controller.ts`

- [ ] **Step 1: Add `telegram` to allowed toolkits and route connect/disconnect**

In `backend/src/controllers/integration.controller.ts`:

**Line 7 — extend `ALLOWED_TOOLKITS`:**
```typescript
const ALLOWED_TOOLKITS = ['gmail', 'slack', 'telegram'] as const;
```

**`connect` method — add Telegram branch before the Composio path:**
```typescript
@Post('/connect/:toolkit')
@UseGuards(AuthGuard)
async connect(_req: Request, user: AuthenticatedUser, params: { toolkit: string }) {
  if (!isAllowedToolkit(params.toolkit)) {
    return new Response(JSON.stringify({ error: 'Unsupported toolkit' }), { status: 400 });
  }
  if (params.toolkit === 'telegram') {
    return this.integrationService.connectTelegram(user.id);
  }
  const baseUrl = (process.env.FRONTEND_URL || process.env.APP_URL || '').replace(/\/$/, '');
  const callbackUrl = `${baseUrl}/oauth/callback`;
  const result = await this.integrationService.getAuthUrl(user.id, params.toolkit, callbackUrl);
  return result;
}
```

**`disconnect` method — handle `telegram:<userId>` IDs:**
```typescript
@Delete('/:id')
@UseGuards(AuthGuard)
async disconnect(_req: Request, user: AuthenticatedUser, params: { id: string }) {
  if (params.id.startsWith('telegram:')) {
    await this.integrationService.disconnectTelegram(user.id);
    return { success: true };
  }
  const connections = await this.integrationService.listConnections(user.id);
  const conn = connections.find((c) => c.id === params.id);
  if (!conn) {
    return new Response(JSON.stringify({ error: 'Connection not found' }), { status: 404 });
  }
  await this.integrationService.cleanupConnectionLinks(conn.id);
  const result = await this.integrationService.disconnect(conn.id);
  return result;
}
```

- [ ] **Step 2: Lint check**

```bash
cd backend && bun run lint
```

- [ ] **Step 3: Commit**

```bash
git add backend/src/controllers/integration.controller.ts
git -c commit.gpgsign=false commit -m "feat(telegram): route telegram connect/disconnect in IntegrationController"
```

---

## Task 9: NotificationQueue — opportunity Telegram delivery

**Files:**
- Modify: `backend/src/queues/notification.queue.ts`
- Modify: `backend/src/queues/tests/notification.queue.spec.ts`

- [ ] **Step 1: Write failing tests**

Open `backend/src/queues/tests/notification.queue.spec.ts` and add a new `describe` block after the existing tests:

```typescript
import { emitTelegramNotification, onTelegramNotification } from '../../lib/notification-events';

describe('processOpportunityNotification — Telegram delivery', () => {
  it('emits Telegram notification when user has telegram prefs with opportunityAccepted=true', async () => {
    const opportunityId = 'opp-tg-1';
    const recipientId = 'user-tg-1';

    // Intercept the emitted Telegram event
    const received: unknown[] = [];
    const unsub = onTelegramNotification((p) => received.push(p));

    const db = makeDb({
      opportunity: makeOpportunity(opportunityId, recipientId, 'A great match'),
      telegramPrefs: { opportunityAccepted: true, negotiationTurn: false },
    });
    const queue = new NotificationQueue({ database: db });
    await queue.processJob('process_opportunity_notification', {
      opportunityId,
      recipientId,
      priority: 'high',
    });

    unsub();
    expect(received).toHaveLength(1);
    expect((received[0] as { userId: string }).userId).toBe(recipientId);
  });

  it('does NOT emit Telegram notification when opportunityAccepted=false', async () => {
    const received: unknown[] = [];
    const unsub = onTelegramNotification((p) => received.push(p));

    const db = makeDb({
      opportunity: makeOpportunity('opp-2', 'user-2', 'A match'),
      telegramPrefs: { opportunityAccepted: false, negotiationTurn: false },
    });
    const queue = new NotificationQueue({ database: db });
    await queue.processJob('process_opportunity_notification', {
      opportunityId: 'opp-2',
      recipientId: 'user-2',
      priority: 'high',
    });

    unsub();
    expect(received).toHaveLength(0);
  });

  it('does NOT emit Telegram notification when user has no telegram prefs', async () => {
    const received: unknown[] = [];
    const unsub = onTelegramNotification((p) => received.push(p));

    const db = makeDb({
      opportunity: makeOpportunity('opp-3', 'user-3', 'A match'),
      telegramPrefs: null,
    });
    const queue = new NotificationQueue({ database: db });
    await queue.processJob('process_opportunity_notification', {
      opportunityId: 'opp-3',
      recipientId: 'user-3',
      priority: 'high',
    });

    unsub();
    expect(received).toHaveLength(0);
  });
});
```

Also update `makeDb` and `makeOpportunity` helpers in the same spec file to support `telegramPrefs`:

```typescript
// In makeDb — add optional telegramPrefs parameter:
function makeDb(opts: { opportunity: ReturnType<typeof makeOpportunity>; telegramPrefs?: { opportunityAccepted: boolean; negotiationTurn: boolean } | null }) {
  return {
    getOpportunity: async (id: string) => id === opts.opportunity.id ? opts.opportunity : null,
    getTelegramPrefs: async (_userId: string) => opts.telegramPrefs
      ? { chatId: 'tg-chat', connectedAt: '2026-01-01T00:00:00Z', notifications: opts.telegramPrefs }
      : null,
  };
}
```

- [ ] **Step 2: Run — expect failures on the new tests**

```bash
cd backend && bun test src/queues/tests/notification.queue.spec.ts 2>&1 | grep -E "FAIL|pass|getTelegramPrefs"
```

- [ ] **Step 3: Add Telegram delivery to `processOpportunityNotification`**

In `backend/src/queues/notification.queue.ts`:

**Add import** at the top:
```typescript
import { emitTelegramNotification } from '../lib/notification-events';
import { userDatabaseAdapter } from '../adapters/database.adapter';
```

**Extend `NotificationQueueDatabase` interface:**
```typescript
export type NotificationQueueDatabase = Pick<ChatDatabaseAdapter, 'getOpportunity'> & {
  getTelegramPrefs(userId: string): Promise<import('../schemas/database.schema').TelegramPrefs | null>;
};
```

**Update `this.database` field type accordingly** (it will now enforce `getTelegramPrefs`). For the default production path, provide a small wrapper:

In the constructor, replace the `this.database` assignment:
```typescript
this.database = deps?.database ?? {
  getOpportunity: (id: string) => new ChatDatabaseAdapter().getOpportunity(id),
  getTelegramPrefs: (userId: string) => userDatabaseAdapter.getTelegramPrefs(userId),
};
```

**Add Telegram delivery at the end of `processOpportunityNotification`** (after the `switch (priority)` block, before the closing `}`):

```typescript
// Telegram delivery (independent of priority tier)
const telegramPrefs = await (this.database as NotificationQueueDatabase).getTelegramPrefs(recipientId);
if (telegramPrefs?.notifications.opportunityAccepted) {
  const opportunityUrl = `${FRONTEND_URL}/opportunities/${opportunityId}`;
  emitTelegramNotification({
    userId: recipientId,
    message: `New connection: ${summary}`,
    inlineButtons: [{ text: 'View opportunity', url: opportunityUrl }],
  });
  this.logger.info('[NotificationJob] Emitted Telegram opportunity notification', {
    opportunityId,
    recipientId,
  });
}
```

- [ ] **Step 4: Run all notification queue tests — expect pass**

```bash
cd backend && bun test src/queues/tests/notification.queue.spec.ts
```

Expected: all tests pass (existing + 3 new).

- [ ] **Step 5: Commit**

```bash
git add backend/src/queues/notification.queue.ts backend/src/queues/tests/notification.queue.spec.ts
git -c commit.gpgsign=false commit -m "feat(telegram): add Telegram delivery branch to NotificationQueue opportunity handler"
```

---

## Task 10: NotificationQueue — negotiation job type

**Files:**
- Modify: `backend/src/queues/notification.queue.ts`
- Modify: `backend/src/queues/tests/notification.queue.spec.ts`

- [ ] **Step 1: Write failing test**

Append to `backend/src/queues/tests/notification.queue.spec.ts`:

```typescript
describe('processJob — process_negotiation_notification', () => {
  it('emits Telegram notification when negotiationTurn=true', async () => {
    const received: unknown[] = [];
    const unsub = onTelegramNotification((p) => received.push(p));

    const db = makeDb({
      opportunity: makeOpportunity('opp-x', 'user-x', 'ignored'),
      telegramPrefs: { opportunityAccepted: false, negotiationTurn: true },
    });
    const queue = new NotificationQueue({ database: db });
    await queue.processJob('process_negotiation_notification', {
      negotiationId: 'neg-1',
      recipientId: 'user-x',
      turnNumber: 2,
      counterpartyAction: 'propose',
    } as NegotiationNotificationJobData);

    unsub();
    expect(received).toHaveLength(1);
    expect((received[0] as { userId: string }).userId).toBe('user-x');
  });

  it('does NOT emit when negotiationTurn=false', async () => {
    const received: unknown[] = [];
    const unsub = onTelegramNotification((p) => received.push(p));

    const db = makeDb({
      opportunity: makeOpportunity('opp-y', 'user-y', 'ignored'),
      telegramPrefs: { opportunityAccepted: false, negotiationTurn: false },
    });
    const queue = new NotificationQueue({ database: db });
    await queue.processJob('process_negotiation_notification', {
      negotiationId: 'neg-2',
      recipientId: 'user-y',
      turnNumber: 1,
      counterpartyAction: 'question',
    } as NegotiationNotificationJobData);

    unsub();
    expect(received).toHaveLength(0);
  });
});
```

Also add the import at the top of the spec:
```typescript
import type { NegotiationNotificationJobData } from '../../queues/notification.queue';
```

- [ ] **Step 2: Run — expect failure**

```bash
cd backend && bun test src/queues/tests/notification.queue.spec.ts 2>&1 | grep "negotiation"
```

Expected: `process_negotiation_notification is not handled` or similar.

- [ ] **Step 3: Add the negotiation job type**

In `backend/src/queues/notification.queue.ts`:

**Export the new job data type** after `NotificationJobData`:
```typescript
/** Payload for a single negotiation notification job. */
export interface NegotiationNotificationJobData {
  negotiationId: string;
  recipientId: string;
  turnNumber: number;
  counterpartyAction: string;
}
```

**Add a `queueNegotiationNotification` helper method** to the `NotificationQueue` class:
```typescript
async queueNegotiationNotification(
  negotiationId: string,
  recipientId: string,
  turnNumber: number,
  counterpartyAction: string,
): Promise<void> {
  await this.queue.add(
    'process_negotiation_notification',
    { negotiationId, recipientId, turnNumber, counterpartyAction },
    {
      attempts: 3,
      backoff: { type: 'exponential', delay: 1000 },
      removeOnComplete: { age: 24 * 60 * 60 },
      removeOnFail: { age: 7 * 24 * 60 * 60 },
    },
  );
}
```

**Add a case in `processJob`:**
```typescript
case 'process_negotiation_notification':
  await this.processNegotiationNotification(data as unknown as NegotiationNotificationJobData);
  break;
```

**Add the private handler:**
```typescript
private async processNegotiationNotification(data: NegotiationNotificationJobData): Promise<void> {
  const { negotiationId, recipientId, counterpartyAction } = data;

  const telegramPrefs = await (this.database as NotificationQueueDatabase).getTelegramPrefs(recipientId);
  if (!telegramPrefs?.notifications.negotiationTurn) return;

  emitTelegramNotification({
    userId: recipientId,
    message: `You have a new negotiation turn. ${counterpartyAction === 'propose' ? 'A proposal is waiting for your response.' : `Your counterpart sent: ${counterpartyAction}.`}`,
    inlineButtons: [{ text: 'View negotiation', url: `${FRONTEND_URL}/conversations` }],
  });

  this.logger.info('[NotificationJob] Emitted Telegram negotiation notification', {
    negotiationId,
    recipientId,
  });
}
```

- [ ] **Step 4: Run all notification queue tests — expect pass**

```bash
cd backend && bun test src/queues/tests/notification.queue.spec.ts
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add backend/src/queues/notification.queue.ts backend/src/queues/tests/notification.queue.spec.ts
git -c commit.gpgsign=false commit -m "feat(telegram): add process_negotiation_notification job type to NotificationQueue"
```

---

## Task 11: Wire everything in main.ts + env.example

**Files:**
- Modify: `backend/src/main.ts`
- Modify: `backend/env.example`

- [ ] **Step 1: Update `env.example`**

Append to `backend/env.example`:

```bash
# Telegram Bot (optional — bot notifications and chat)
TELEGRAM_BOT_TOKEN=          # Bot token from @BotFather
TELEGRAM_BOT_USERNAME=       # Bot username without @, e.g. IndexBot
TELEGRAM_WEBHOOK_SECRET=     # Random secret for webhook validation
```

- [ ] **Step 2: Register `WebhooksController` in `main.ts`**

Add the import alongside other controller imports:
```typescript
import { WebhooksController } from './controllers/webhooks.controller';
```

Add to the `controllerInstances.set(...)` block (after `IntegrationController`):
```typescript
controllerInstances.set(WebhooksController, new WebhooksController());
```

- [ ] **Step 3: Wire `NegotiationEvents` and startup calls**

Add imports near the top of `main.ts`:
```typescript
import { NegotiationEvents } from './events/negotiation.event';
import { init as initTelegramGateway } from './gateways/telegram.gateway';
import { setWebhook } from './lib/telegram/bot-api';
import { notificationQueue } from './queues/notification.queue';
```

After the existing `startWorker()` calls (around line 55), add:

```typescript
// ── Telegram bot startup ────────────────────────────────────────────────────
if (process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_WEBHOOK_SECRET) {
  const webhookBase = process.env.BASE_URL ?? process.env.APP_URL ?? '';
  const webhookUrl = `${webhookBase.replace(/\/$/, '')}/api/webhooks/telegram`;
  setWebhook(webhookUrl, process.env.TELEGRAM_WEBHOOK_SECRET).catch((err) => {
    logger.error('Failed to register Telegram webhook on startup', { error: err });
  });
  initTelegramGateway();
  logger.info('Telegram bot gateway initialised', { webhookUrl });
}

// ── NegotiationEvents → Telegram notifications ──────────────────────────────
NegotiationEvents.onTurnReceived = (data) => {
  notificationQueue.queueNegotiationNotification(
    data.negotiationId,
    data.userId,
    data.turnNumber,
    data.counterpartyAction,
  ).catch((err) => {
    logger.error('Failed to enqueue negotiation notification', { negotiationId: data.negotiationId, error: err });
  });
};
```

- [ ] **Step 4: Verify the backend starts cleanly**

```bash
cd backend && bun run dev &
sleep 3
kill %1
```

Expected: server starts on port 3001, no errors about missing Telegram env vars (startup is conditional).

- [ ] **Step 5: Run the full test suite for the new files**

```bash
cd backend && bun test src/lib/telegram/tests/bot-api.spec.ts src/gateways/tests/telegram.gateway.spec.ts src/services/tests/integration.service.telegram.spec.ts src/queues/tests/notification.queue.spec.ts
```

Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add backend/src/main.ts backend/env.example
git -c commit.gpgsign=false commit -m "feat(telegram): wire gateway init, NegotiationEvents, WebhooksController, and setWebhook in main.ts"
```

---

## Self-Review

**Spec coverage check:**

| Spec requirement | Task |
|---|---|
| Telegram bot token auth via BotFather | Task 2 (bot-api helper uses `TELEGRAM_BOT_TOKEN`) |
| Deep link connect flow (one-time Redis token) | Tasks 5 + 7 |
| Store chatId + sessionId in `prefs.telegram` | Tasks 1 + 5 |
| Connect/disconnect via IntegrationController/Service | Tasks 7 + 8 |
| `listConnections` includes synthetic Telegram entry | Task 7 |
| Gateway is single point of delivery | Tasks 4 + 5 |
| `handleOutbound`: send message + write to conversation | Task 4 |
| Lazy session creation on first notification | Task 4 |
| `handleInbound`: route to ChatSessionService | Task 5 |
| Write user + assistant messages to conversation | Task 5 |
| `/start <token>` completes connection | Task 5 |
| `POST /webhooks/telegram` with secret validation | Task 6 |
| Opportunity Telegram notification (default on) | Task 9 |
| Negotiation Telegram notification (default off) | Task 10 |
| `NegotiationEvents.onTurnReceived` wired | Task 11 |
| `setWebhook` called at startup | Task 11 |
| Env vars documented | Task 11 |

**Type consistency:** `TelegramPrefs` defined once in `database.schema.ts` and imported everywhere — consistent across all tasks. `GatewayDeps` interface used in both outbound and inbound handlers. `NegotiationNotificationJobData` exported and imported in the test.

**Placeholder check:** No TBDs. All method signatures, imports, and test fixtures are concrete.
