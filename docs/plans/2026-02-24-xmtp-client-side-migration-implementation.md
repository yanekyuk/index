# XMTP Client-Side Migration Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Move XMTP from server-side to client-side, add wallet-based auth, and introduce an Index Bot that sends opportunity messages into 3-way group conversations.

**Architecture:** Frontend creates XMTP clients directly in the browser using the user's connected wallet. The server operates a single Index Bot XMTP client that creates groups and sends structured opportunity messages. Every user-pair conversation is a 3-way group (User A + User B + Bot).

**Tech Stack:** `@xmtp/browser-sdk` (frontend), `@xmtp/node-sdk` (bot only), `wagmi` + `viem` + `@walletconnect/web3wallet` (wallet connection), Drizzle ORM (conversations table), BullMQ (notification queue)

**Design doc:** `docs/plans/2026-02-24-xmtp-client-side-migration-design.md`

---

## Phase 1: Protocol Cleanup — Remove Server-Side User XMTP

### Task 1: Remove wallet auto-creation hook from auth

**Files:**
- Modify: `protocol/src/lib/auth.ts` (remove `setWalletHook` / `_ensureWallet`)
- Modify: `protocol/src/main.ts` (remove `setWalletHook` call and `messagingStore.ensureWallet` usage)

**Step 1: Remove the wallet hook from auth.ts**

In `protocol/src/lib/auth.ts`, remove the `_ensureWallet` variable, `setWalletHook` export, and the `_ensureWallet(user.id)` call in `databaseHooks.user.create.after`.

**Step 2: Remove the wallet hook wiring from main.ts**

In `protocol/src/main.ts`, remove:
- `import { setWalletHook } from './lib/auth'` (if present as separate import)
- `setWalletHook((userId) => messagingStore.ensureWallet(userId));`

**Step 3: Verify the server still starts**

Run: `cd protocol && bun run dev` — confirm no import errors or crashes.

**Step 4: Commit**

```bash
git add protocol/src/lib/auth.ts protocol/src/main.ts
git commit -m "refactor: remove wallet auto-creation hook from auth"
```

---

### Task 2: Remove MessagingController and its routes

**Files:**
- Delete: `protocol/src/controllers/messaging.controller.ts`
- Modify: `protocol/src/main.ts` (remove controller import and registration)

**Step 1: Remove the controller import and registration from main.ts**

In `protocol/src/main.ts`, remove:
- `import { MessagingController } from './controllers/messaging.controller';`
- `controllerInstances.set(MessagingController, new MessagingController(messagingService));`

**Step 2: Delete the controller file**

Delete `protocol/src/controllers/messaging.controller.ts`.

**Step 3: Verify server starts**

Run: `cd protocol && bun run dev`

**Step 4: Commit**

```bash
git add -A protocol/src/controllers/messaging.controller.ts protocol/src/main.ts
git commit -m "refactor: remove MessagingController and all /xmtp endpoints"
```

---

### Task 3: Remove MessagingService

**Files:**
- Delete: `protocol/src/services/messaging.service.ts`
- Modify: `protocol/src/main.ts` (remove service import and instantiation)

**Step 1: Remove service wiring from main.ts**

In `protocol/src/main.ts`, remove:
- `import { MessagingService } from './services/messaging.service';`
- The entire `messagingService` instantiation block (the `new MessagingService(messagingStore, {...})` call)

**Step 2: Delete the service file**

Delete `protocol/src/services/messaging.service.ts`.

**Step 3: Verify server starts**

Run: `cd protocol && bun run dev`

**Step 4: Commit**

```bash
git add -A protocol/src/services/messaging.service.ts protocol/src/main.ts
git commit -m "refactor: remove MessagingService"
```

---

### Task 4: Remove MessagingAdapter

**Files:**
- Delete: `protocol/src/adapters/messaging.adapter.ts`

**Step 1: Check for remaining imports**

Search for any file importing `messaging.adapter` — should be none after Task 3 removed the service.

**Step 2: Delete the adapter file**

Delete `protocol/src/adapters/messaging.adapter.ts`.

**Step 3: Commit**

```bash
git add -A protocol/src/adapters/messaging.adapter.ts
git commit -m "refactor: remove MessagingAdapter"
```

---

### Task 5: Remove MessagingDatabaseAdapter and user wallet functions

**Files:**
- Modify: `protocol/src/adapters/database.adapter.ts` (remove `MessagingDatabaseAdapter` class, ~lines 3497-3586)
- Modify: `protocol/src/lib/xmtp/xmtp.crypto.ts` (remove `generateWallet`, keep `deriveDbEncryptionKey` for bot)
- Modify: `protocol/src/lib/xmtp/xmtp.client.ts` (remove user-facing helpers, keep `createSigner`, `createXmtpClient` for bot)
- Modify: `protocol/src/lib/xmtp/xmtp.interface.ts` (remove `MessagingStore` interface)
- Modify: `protocol/src/lib/xmtp/index.ts` (update barrel exports)
- Modify: `protocol/src/main.ts` (remove `MessagingDatabaseAdapter` import, `walletMasterKey`, `WALLET_ENCRYPTION_KEY` logic)

**Step 1: Remove MessagingDatabaseAdapter from database.adapter.ts**

Remove the entire `class MessagingDatabaseAdapter implements MessagingStore` block and its imports (`generateWallet`, `decryptKey`, `MessagingStore`).

**Step 2: Clean up xmtp.crypto.ts**

Remove `generateWallet` and `encryptKey` functions. Keep `decryptKey` only if needed elsewhere (likely not — remove it too). Keep `deriveDbEncryptionKey` (needed for bot DB encryption).

**Step 3: Clean up xmtp.interface.ts**

Remove the `MessagingStore` interface entirely. This file can be deleted if nothing else is in it.

**Step 4: Clean up xmtp.client.ts**

Keep `createSigner`, `createXmtpClient`, `extractText`. Remove `findDm` and `createDm` (DM-specific, bot uses groups). Add group helpers later in Phase 2.

**Step 5: Update barrel export**

Update `protocol/src/lib/xmtp/index.ts` to match remaining exports.

**Step 6: Remove wallet master key from main.ts**

Remove `WALLET_ENCRYPTION_KEY` validation, `walletMasterKey` buffer creation, and `messagingStore` instantiation.

**Step 7: Run existing xmtp tests**

Run: `cd protocol && bun test src/lib/xmtp/tests/xmtp.crypto.spec.ts`

Update tests to remove tests for deleted functions (`generateWallet`, `encryptKey`, `decryptKey`).

Run: `cd protocol && bun test src/lib/xmtp/tests/xmtp.client.spec.ts`

Update tests to remove tests for deleted functions (`findDm`, `createDm` if tested).

**Step 8: Commit**

```bash
git add -A protocol/src/adapters/database.adapter.ts protocol/src/lib/xmtp/ protocol/src/main.ts
git commit -m "refactor: remove server-side user wallet management and MessagingStore"
```

---

### Task 6: Clean up hidden_conversations and schema references

**Files:**
- Modify: `protocol/src/schemas/database.schema.ts` (keep `walletAddress` and `xmtpInboxId` columns on users — they're still used for wallet registration. Consider removing `walletEncryptedKey` column. Keep `hidden_conversations` table for now or remove if not needed in new model.)

**Step 1: Evaluate what to keep**

- `walletAddress` — KEEP (users register their wallet)
- `xmtpInboxId` — KEEP (users register their inbox ID)
- `walletEncryptedKey` — REMOVE (server no longer holds encrypted keys)
- `hidden_conversations` table — REMOVE (conversations are now XMTP groups managed client-side; hiding is a client concern)

**Step 2: Generate migration**

```bash
cd protocol && bun run db:generate
```

Rename the generated migration to `0007_drop_wallet_encrypted_key_and_hidden_conversations.sql`. Update `drizzle/meta/_journal.json` tag.

**Step 3: Review and apply migration**

```bash
cd protocol && bun run db:migrate
```

**Step 4: Commit**

```bash
git add protocol/src/schemas/database.schema.ts protocol/drizzle/
git commit -m "refactor: drop walletEncryptedKey column and hidden_conversations table"
```

---

## Phase 2: Protocol — Add Bot Service & Conversations Table

### Task 7: Add conversations table to schema

**Files:**
- Modify: `protocol/src/schemas/database.schema.ts` (add `conversations` table)

**Step 1: Add the table definition**

```typescript
export const conversations = pgTable('conversations', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  userAId: text('user_a_id').notNull().references(() => users.id),
  userBId: text('user_b_id').notNull().references(() => users.id),
  xmtpGroupId: text('xmtp_group_id').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => ({
  uniquePair: unique().on(table.userAId, table.userBId),
}));
```

Convention: `userAId < userBId` alphabetically (enforced in service layer, not DB constraint).

**Step 2: Generate and rename migration**

```bash
cd protocol && bun run db:generate
```

Rename to `0008_create_conversations.sql`, update journal.

**Step 3: Apply migration**

```bash
cd protocol && bun run db:migrate
```

**Step 4: Commit**

```bash
git add protocol/src/schemas/database.schema.ts protocol/drizzle/
git commit -m "feat: add conversations table for user-pair XMTP groups"
```

---

### Task 8: Add group helpers to lib/xmtp

**Files:**
- Modify: `protocol/src/lib/xmtp/xmtp.client.ts` (add `createGroup`, `findGroup`, `sendGroupMessage`)
- Modify: `protocol/src/lib/xmtp/index.ts` (update exports)
- Create: `protocol/src/lib/xmtp/tests/xmtp.bot.spec.ts` (tests for new helpers — mock XMTP client)

**Step 1: Write tests for group helpers**

```typescript
// protocol/src/lib/xmtp/tests/xmtp.bot.spec.ts
import { describe, expect, it } from "bun:test";
import { formatBotMessage, parseBotMessage } from "../xmtp.client";

describe("formatBotMessage", () => {
  it("formats opportunity intro message", () => {
    const msg = formatBotMessage("opportunity", { opportunityId: "123", headline: "Test" });
    expect(msg).toStartWith("[index:opportunity]\n");
    expect(JSON.parse(msg.split("\n").slice(1).join("\n"))).toEqual({
      opportunityId: "123",
      headline: "Test",
    });
  });
});

describe("parseBotMessage", () => {
  it("parses a formatted bot message", () => {
    const raw = '[index:opportunity]\n{"opportunityId":"123"}';
    const parsed = parseBotMessage(raw);
    expect(parsed).toEqual({ type: "opportunity", payload: { opportunityId: "123" } });
  });

  it("returns null for regular text", () => {
    expect(parseBotMessage("hello world")).toBeNull();
  });
});
```

**Step 2: Run tests to verify they fail**

```bash
cd protocol && bun test src/lib/xmtp/tests/xmtp.bot.spec.ts
```

**Step 3: Implement bot message format helpers**

In `protocol/src/lib/xmtp/xmtp.client.ts`, add:

```typescript
export type BotMessageType = 'opportunity' | 'opportunity_update' | 'reminder';

export function formatBotMessage(type: BotMessageType, payload: Record<string, unknown>): string {
  return `[index:${type}]\n${JSON.stringify(payload)}`;
}

export function parseBotMessage(text: string): { type: BotMessageType; payload: Record<string, unknown> } | null {
  const match = text.match(/^\[index:(\w+)\]\n(.+)$/s);
  if (!match) return null;
  try {
    return { type: match[1] as BotMessageType, payload: JSON.parse(match[2]) };
  } catch {
    return null;
  }
}
```

**Step 4: Run tests to verify they pass**

```bash
cd protocol && bun test src/lib/xmtp/tests/xmtp.bot.spec.ts
```

**Step 5: Update barrel export**

Add `formatBotMessage`, `parseBotMessage`, `BotMessageType` to `protocol/src/lib/xmtp/index.ts`.

**Step 6: Commit**

```bash
git add protocol/src/lib/xmtp/
git commit -m "feat: add bot message format/parse helpers with tests"
```

---

### Task 9: Create BotService

**Files:**
- Create: `protocol/src/services/bot.service.ts`
- Create: `protocol/src/services/tests/bot.service.spec.ts`

**Step 1: Write BotService tests**

```typescript
// protocol/src/services/tests/bot.service.spec.ts
import { config } from "dotenv";
config({ path: '.env.development', override: true });

import { describe, expect, it, beforeAll, mock } from "bun:test";
import { BotService } from "../bot.service";

describe("BotService", () => {
  describe("constructor validation", () => {
    it("throws if no private key provided", () => {
      expect(() => new BotService({ privateKey: "", xmtpEnv: "dev" })).toThrow();
    });
  });

  describe("getOrCreateGroup", () => {
    it("normalizes user pair order (userA < userB)", async () => {
      // Test that ("z-user", "a-user") and ("a-user", "z-user") produce the same lookup key
      const service = new BotService({
        privateKey: "0x" + "ab".repeat(32),
        xmtpEnv: "dev",
      });
      const key1 = service.normalizeUserPair("z-user", "a-user");
      const key2 = service.normalizeUserPair("a-user", "z-user");
      expect(key1).toEqual(key2);
      expect(key1).toEqual({ userAId: "a-user", userBId: "z-user" });
    });
  });

  describe("formatOpportunityIntro", () => {
    it("produces a parseable bot message", () => {
      const msg = BotService.formatOpportunityIntro({
        opportunityId: "opp-1",
        headline: "AI Collaboration",
        summary: "Both interested in ML",
      });
      expect(msg).toContain("[index:opportunity]");
      expect(msg).toContain("AI Collaboration");
    });
  });
});
```

**Step 2: Run tests to verify they fail**

```bash
cd protocol && bun test src/services/tests/bot.service.spec.ts
```

**Step 3: Implement BotService**

```typescript
// protocol/src/services/bot.service.ts
import { Client } from "@xmtp/node-sdk";
import { eq, and, or } from "drizzle-orm";

import { createSigner, createXmtpClient, formatBotMessage } from "../lib/xmtp";
import { deriveDbEncryptionKey } from "../lib/xmtp/xmtp.crypto";
import { db } from "../lib/drizzle/drizzle";
import { users, conversations } from "../schemas/database.schema";

export interface BotServiceConfig {
  privateKey: string;       // INDEX_BOT_PRIVATE_KEY hex
  xmtpEnv: 'dev' | 'production' | 'local';
  xmtpDbDir?: string;
}

/**
 * Manages the Index Bot's XMTP client and group conversations.
 * The bot creates 3-way groups (User A + User B + Bot) and sends
 * structured opportunity messages.
 */
export class BotService {
  private client: Client | null = null;
  private readonly config: BotServiceConfig;

  constructor(config: BotServiceConfig) {
    if (!config.privateKey) throw new Error("INDEX_BOT_PRIVATE_KEY is required");
    this.config = config;
  }

  /** Get or lazily initialize the bot's XMTP client. */
  async getClient(): Promise<Client> {
    if (this.client) return this.client;
    const signer = createSigner(this.config.privateKey as `0x${string}`);
    const dbKey = deriveDbEncryptionKey("index-bot", Buffer.from(this.config.privateKey.slice(2), "hex"));
    const dbPath = this.config.xmtpDbDir
      ? `${this.config.xmtpDbDir}/${this.config.xmtpEnv}-bot`
      : undefined;
    this.client = await createXmtpClient(signer, dbKey, this.config.xmtpEnv, dbPath);
    return this.client;
  }

  /** Get the bot's inbox ID (initializes client if needed). */
  async getInboxId(): Promise<string> {
    const client = await this.getClient();
    return client.inboxId;
  }

  /** Normalize user pair so userAId < userBId alphabetically. */
  normalizeUserPair(id1: string, id2: string): { userAId: string; userBId: string } {
    return id1 < id2
      ? { userAId: id1, userBId: id2 }
      : { userAId: id2, userBId: id1 };
  }

  /** Look up or create a 3-way XMTP group for a user pair. */
  async getOrCreateGroup(userId1: string, userId2: string): Promise<string> {
    const { userAId, userBId } = this.normalizeUserPair(userId1, userId2);

    // Check DB for existing group
    const existing = await db
      .select()
      .from(conversations)
      .where(and(eq(conversations.userAId, userAId), eq(conversations.userBId, userBId)))
      .limit(1);

    if (existing.length > 0) return existing[0].xmtpGroupId;

    // Look up both users' inboxIds
    const [userA, userB] = await Promise.all([
      db.select({ xmtpInboxId: users.xmtpInboxId }).from(users).where(eq(users.id, userAId)).limit(1),
      db.select({ xmtpInboxId: users.xmtpInboxId }).from(users).where(eq(users.id, userBId)).limit(1),
    ]);

    const inboxA = userA[0]?.xmtpInboxId;
    const inboxB = userB[0]?.xmtpInboxId;
    if (!inboxA || !inboxB) {
      throw new Error(`Cannot create group: missing inboxId for ${!inboxA ? userAId : userBId}`);
    }

    // Create XMTP group
    const client = await this.getClient();
    await client.conversations.syncAll();
    const group = await client.conversations.createGroup([inboxA, inboxB]);
    const groupId = group.id;

    // Store in DB
    await db.insert(conversations).values({ userAId, userBId, xmtpGroupId: groupId });

    return groupId;
  }

  /** Send an opportunity intro message to a user-pair group. */
  async sendOpportunityIntro(
    userId1: string,
    userId2: string,
    opportunity: { opportunityId: string; headline: string; summary: string },
  ): Promise<void> {
    const groupId = await this.getOrCreateGroup(userId1, userId2);
    const client = await this.getClient();
    await client.conversations.syncAll();
    const conversation = await client.conversations.getConversationById(groupId);
    if (!conversation) throw new Error(`Group ${groupId} not found`);
    const message = formatBotMessage("opportunity", opportunity);
    await conversation.sendText(message);
  }

  /** Send an opportunity status update to a user-pair group. */
  async sendOpportunityUpdate(
    userId1: string,
    userId2: string,
    update: { opportunityId: string; status: string },
  ): Promise<void> {
    const groupId = await this.getOrCreateGroup(userId1, userId2);
    const client = await this.getClient();
    await client.conversations.syncAll();
    const conversation = await client.conversations.getConversationById(groupId);
    if (!conversation) throw new Error(`Group ${groupId} not found`);
    const message = formatBotMessage("opportunity_update", update);
    await conversation.sendText(message);
  }

  /** Format an opportunity intro message (static, for testing). */
  static formatOpportunityIntro(opp: { opportunityId: string; headline: string; summary: string }): string {
    return formatBotMessage("opportunity", opp);
  }
}
```

**Step 4: Run tests to verify they pass**

```bash
cd protocol && bun test src/services/tests/bot.service.spec.ts
```

**Step 5: Commit**

```bash
git add protocol/src/services/bot.service.ts protocol/src/services/tests/bot.service.spec.ts
git commit -m "feat: add BotService for Index Bot XMTP group management"
```

---

### Task 10: Wire BotService into main.ts and add bot endpoint

**Files:**
- Modify: `protocol/src/main.ts` (instantiate BotService, create BotController or inline route)
- Create: `protocol/src/controllers/bot.controller.ts`

**Step 1: Create BotController**

```typescript
// protocol/src/controllers/bot.controller.ts
import { Controller, Get } from "../lib/router/router.decorators";
import type { BotService } from "../services/bot.service";

/**
 * Minimal controller exposing the Index Bot's public identity.
 */
@Controller('/bot')
export class BotController {
  constructor(private readonly botService: BotService) {}

  @Get('/inbox-id')
  async getInboxId() {
    const inboxId = await this.botService.getInboxId();
    return Response.json({ inboxId });
  }
}
```

**Step 2: Wire in main.ts**

Add to `protocol/src/main.ts`:

```typescript
import { BotService } from './services/bot.service';
import { BotController } from './controllers/bot.controller';

// After existing setup:
const botPrivateKey = process.env.INDEX_BOT_PRIVATE_KEY;
let botService: BotService | null = null;
if (botPrivateKey) {
  botService = new BotService({
    privateKey: botPrivateKey,
    xmtpEnv: (process.env.XMTP_ENV as 'dev' | 'production' | 'local') || 'dev',
    xmtpDbDir: path.resolve(import.meta.dir, '../.xmtp'),
  });
  controllerInstances.set(BotController, new BotController(botService));
}
```

**Step 3: Verify server starts**

Run: `cd protocol && bun run dev`

**Step 4: Commit**

```bash
git add protocol/src/controllers/bot.controller.ts protocol/src/main.ts
git commit -m "feat: wire BotService and BotController into server"
```

---

### Task 11: Add XMTP bot message to notification queue

**Files:**
- Modify: `protocol/src/queues/notification.queue.ts` (add XMTP delivery channel)
- Modify: `protocol/src/queues/tests/notification.queue.spec.ts` (add tests for XMTP delivery)

**Step 1: Add test for XMTP notification delivery**

Add a test case to `notification.queue.spec.ts`:

```typescript
describe("XMTP bot notification", () => {
  it("sends XMTP message when both users have inboxIds", async () => {
    // Mock BotService.sendOpportunityIntro
    // Verify it's called with correct user IDs and opportunity data
  });

  it("skips XMTP when a user has no inboxId", async () => {
    // Ensure no XMTP message is sent, only email
  });
});
```

**Step 2: Modify notification queue to accept BotService**

The notification queue needs access to `BotService`. Options:
- Pass via constructor/singleton
- Import lazily

Add a `setBotService(service)` function similar to the old `setWalletHook` pattern, or pass the bot service to the queue at startup.

In the `processOpportunityNotification` handler, after the existing email logic, add:

```typescript
// Send XMTP bot message (if both users have connected wallets)
if (botService) {
  try {
    const [actor1, actor2] = opportunity.actors; // The two users
    await botService.sendOpportunityIntro(actor1.userId, actor2.userId, {
      opportunityId: opportunity.id,
      headline: opportunity.headline,
      summary: opportunity.summary,
    });
  } catch (err) {
    console.error('[NotificationQueue] XMTP bot message failed:', err);
    // Don't fail the job — email was already sent
  }
}
```

**Step 3: Run notification tests**

```bash
cd protocol && bun test src/queues/tests/notification.queue.spec.ts
```

**Step 4: Commit**

```bash
git add protocol/src/queues/notification.queue.ts protocol/src/queues/tests/notification.queue.spec.ts
git commit -m "feat: add XMTP bot message delivery to notification queue"
```

---

### Task 12: Add user wallet and inboxId registration endpoints

**Files:**
- Modify: `protocol/src/controllers/user.controller.ts` (or create if needed — add POST /users/wallet and POST /users/xmtp-inbox)

**Step 1: Check existing user controller**

Read `protocol/src/controllers/user.controller.ts` to understand existing structure.

**Step 2: Add wallet registration endpoint**

```typescript
@Post('/wallet')
@UseGuards(AuthGuard)
async registerWallet(req: Request, user: AuthenticatedUser) {
  const body = await req.json() as { walletAddress?: string };
  if (!body.walletAddress) {
    return Response.json({ error: 'walletAddress is required' }, { status: 400 });
  }
  await db.update(users).set({ walletAddress: body.walletAddress }).where(eq(users.id, user.id));
  return Response.json({ ok: true });
}
```

**Step 3: Add inboxId registration endpoint**

```typescript
@Post('/xmtp-inbox')
@UseGuards(AuthGuard)
async registerXmtpInbox(req: Request, user: AuthenticatedUser) {
  const body = await req.json() as { inboxId?: string };
  if (!body.inboxId) {
    return Response.json({ error: 'inboxId is required' }, { status: 400 });
  }
  await db.update(users).set({ xmtpInboxId: body.inboxId }).where(eq(users.id, user.id));
  return Response.json({ ok: true });
}
```

**Step 4: Verify endpoints work**

Run: `cd protocol && bun run dev` — test with curl.

**Step 5: Commit**

```bash
git add protocol/src/controllers/user.controller.ts
git commit -m "feat: add wallet and XMTP inbox registration endpoints"
```

---

## Phase 3: Frontend — Wallet Connection

### Task 13: Add wallet dependencies

**Files:**
- Modify: `frontend/package.json`

**Step 1: Install wagmi, viem, and WalletConnect**

```bash
cd frontend && bun add wagmi viem @tanstack/react-query @walletconnect/ethereum-provider
```

Note: Check XMTP browser SDK compatibility. Install:

```bash
cd frontend && bun add @xmtp/browser-sdk
```

**Step 2: Commit**

```bash
git add frontend/package.json frontend/bun.lock
git commit -m "feat: add wagmi, viem, WalletConnect, and XMTP browser SDK dependencies"
```

---

### Task 14: Create wallet connection config and provider

**Files:**
- Create: `frontend/src/lib/wagmi.ts` (wagmi config)
- Modify: `frontend/src/components/ClientWrapper.tsx` (add WagmiProvider)

**Step 1: Create wagmi config**

```typescript
// frontend/src/lib/wagmi.ts
import { createConfig, http } from 'wagmi';
import { mainnet } from 'wagmi/chains';

export const wagmiConfig = createConfig({
  chains: [mainnet],
  transports: {
    [mainnet.id]: http(),
  },
});
```

**Step 2: Wrap app in WagmiProvider and QueryClientProvider**

In `frontend/src/components/ClientWrapper.tsx`, add:

```typescript
import { WagmiProvider } from 'wagmi';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { wagmiConfig } from '../lib/wagmi';

const queryClient = new QueryClient();
```

Wrap the existing JSX with `<WagmiProvider config={wagmiConfig}><QueryClientProvider client={queryClient}>...</QueryClientProvider></WagmiProvider>`.

**Step 3: Verify the app still builds**

```bash
cd frontend && bun run build
```

**Step 4: Commit**

```bash
git add frontend/src/lib/wagmi.ts frontend/src/components/ClientWrapper.tsx
git commit -m "feat: add WagmiProvider and wallet connection config"
```

---

### Task 15: Create wallet connect UI component

**Files:**
- Create: `frontend/src/components/WalletConnect.tsx`

**Step 1: Implement wallet connect component**

```typescript
// frontend/src/components/WalletConnect.tsx
'use client';

import { useAccount, useConnect, useDisconnect } from 'wagmi';
import { injected } from 'wagmi/connectors';
import { useAuthenticatedAPI } from '../lib/api';
import { useCallback } from 'react';

export function WalletConnect() {
  const { address, isConnected } = useAccount();
  const { connect } = useConnect();
  const { disconnect } = useDisconnect();
  const { api } = useAuthenticatedAPI();

  const handleConnect = useCallback(async () => {
    connect({ connector: injected() });
  }, [connect]);

  // Register wallet address with backend after connection
  // This will be called from the XMTP init flow

  if (isConnected && address) {
    return (
      <div>
        <span>{address.slice(0, 6)}...{address.slice(-4)}</span>
        <button onClick={() => disconnect()}>Disconnect</button>
      </div>
    );
  }

  return (
    <button onClick={handleConnect}>Connect Wallet</button>
  );
}
```

**Step 2: Commit**

```bash
git add frontend/src/components/WalletConnect.tsx
git commit -m "feat: add WalletConnect component for wallet connection"
```

---

## Phase 4: Frontend — Client-Side XMTP

### Task 16: Rewrite XMTPContext for client-side XMTP

**Files:**
- Rewrite: `frontend/src/contexts/XMTPContext.tsx`
- Rewrite: `frontend/src/services/xmtp.ts`

This is the largest single task. The context needs to:
1. Create an XMTP client in the browser using the connected wallet as signer
2. Register the inboxId with the backend
3. Manage conversations (list, create) directly via XMTP browser SDK
4. Stream messages directly via XMTP browser SDK
5. Still fetch opportunity context from the backend API

**Step 1: Rewrite services/xmtp.ts**

Strip down to only the backend API calls that remain:

```typescript
// frontend/src/services/xmtp.ts
import type { AuthenticatedAPI } from '../lib/api';

export interface OpportunityContext {
  opportunityId: string;
  headline: string;
  summary: string;
  peerName: string;
  peerAvatar: string | null;
  acceptedAt: string | null;
}

export function createXmtpApiService(api: AuthenticatedAPI) {
  return {
    getChatContext: (peerUserId: string) =>
      api.get<{ opportunities: OpportunityContext[] }>(`/opportunities/chat-context?peerUserId=${peerUserId}`),
    registerWallet: (walletAddress: string) =>
      api.post('/users/wallet', { walletAddress }),
    registerInboxId: (inboxId: string) =>
      api.post('/users/xmtp-inbox', { inboxId }),
    getBotInboxId: () =>
      api.get<{ inboxId: string }>('/bot/inbox-id'),
  };
}
```

**Step 2: Rewrite XMTPContext.tsx**

The new context:
- Uses `useAccount()` from wagmi to get the connected wallet
- Creates XMTP browser SDK client with wallet signer
- Registers inboxId with backend
- Provides: `client`, `conversations`, `messages`, `sendMessage`, `isReady`, `botInboxId`
- Streams messages from all conversations

This requires careful implementation using `@xmtp/browser-sdk`. Consult the XMTP browser SDK docs for exact API. The key pattern:

```typescript
import { Client } from '@xmtp/browser-sdk';

// Create client with wallet signer
const client = await Client.create(walletSigner, { env: 'dev' });

// List conversations
const convos = await client.conversations.list();

// Stream all messages
const stream = client.conversations.streamAllMessages();
for await (const message of stream) {
  // handle message
}
```

**Step 3: Update ChatView, ChatSidebar, Sidebar to use new context shape**

The `useXMTP()` hook interface changes. Update all consumers.

**Step 4: Build and verify**

```bash
cd frontend && bun run build
```

**Step 5: Commit**

```bash
git add frontend/src/contexts/XMTPContext.tsx frontend/src/services/xmtp.ts frontend/src/components/
git commit -m "feat: rewrite XMTP to client-side with browser SDK and wallet auth"
```

---

### Task 17: Update ChatView for group conversations and bot messages

**Files:**
- Modify: `frontend/src/components/chat/ChatView.tsx`
- Modify: `frontend/src/components/chat/SystemMessageCard.tsx` (ensure it handles bot message format)

**Step 1: Update ChatView**

- Remove DM-specific logic (no more `initialGroupId` from URL params)
- Conversations are groups — look up by peer user's inboxId
- Detect bot messages by checking `senderInboxId === botInboxId` and parsing with `parseBotMessage`
- Render bot messages with `SystemMessageCard`

**Step 2: Update SystemMessageCard**

Ensure it can parse the `[index:opportunity]` format and render the opportunity card.

**Step 3: Build and verify**

```bash
cd frontend && bun run build
```

**Step 4: Commit**

```bash
git add frontend/src/components/chat/
git commit -m "feat: update ChatView for group conversations and bot message rendering"
```

---

### Task 18: Update ChatSidebar for group conversations

**Files:**
- Modify: `frontend/src/components/ChatSidebar.tsx`

**Step 1: Update conversation list**

- Use `client.conversations.list()` (groups, not DMs)
- For each group, identify the "other human" by filtering out the bot's inboxId and the current user's inboxId
- Display peer's name/avatar (resolve via API or XMTP metadata)

**Step 2: Build and verify**

```bash
cd frontend && bun run build
```

**Step 3: Commit**

```bash
git add frontend/src/components/ChatSidebar.tsx
git commit -m "feat: update ChatSidebar for group conversations"
```

---

## Phase 5: Cleanup & Testing

### Task 19: Remove unused server-side XMTP files

**Files:**
- Delete: `protocol/.xmtp/` directory (old per-user XMTP databases)
- Clean up any remaining dead imports

**Step 1: Remove .xmtp directory**

```bash
rm -rf protocol/.xmtp/
```

Ensure `.xmtp/` is in `.gitignore`.

**Step 2: Search for dead imports**

Search for any remaining imports of deleted modules.

**Step 3: Commit**

```bash
git add -A
git commit -m "chore: clean up unused server-side XMTP artifacts"
```

---

### Task 20: End-to-end manual testing

**Steps:**
1. Start protocol: `cd protocol && bun run dev`
2. Start frontend: `cd frontend && bun run dev`
3. Test wallet connection flow
4. Test XMTP client initialization in browser
5. Test sending a message (creates 3-way group)
6. Test receiving a bot opportunity message (trigger via notification queue)
7. Test conversation list rendering
8. Test cross-device (connect same wallet in different browser)

**Do not commit until all manual tests pass.**

---

### Task 21: Update environment documentation

**Files:**
- Modify: `protocol/env.example` (remove `WALLET_ENCRYPTION_KEY`, add `INDEX_BOT_PRIVATE_KEY`)
- Modify: `frontend/.env.example` (add `NEXT_PUBLIC_INDEX_BOT_INBOX_ID` if used)

**Step 1: Update env examples**

**Step 2: Commit**

```bash
git add protocol/env.example frontend/.env.example
git commit -m "docs: update environment variable documentation for client-side XMTP"
```
