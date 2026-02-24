# XMTP Messaging Refactor Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Restructure the XMTP messaging implementation into proper layering: lib (pure SDK + interface) → adapter (infra + DI) → service (business logic) → controller (HTTP).

**Architecture:** Extract pure XMTP SDK operations and crypto into `lib/xmtp/`. Define a `MessagingStore` interface in the lib that the adapter receives via constructor injection for DB access. The adapter composes lib functions with the injected store. A messaging service handles business logic (hidden-conversation filtering, peer resolution). The controller becomes a thin HTTP layer. Chat-context (opportunity queries) moves to the opportunity controller.

**Tech Stack:** TypeScript, @xmtp/node-sdk, viem, node:crypto, Drizzle ORM, Bun

---

### Task 1: Create `lib/xmtp/xmtp.interface.ts`

**Files:**
- Create: `protocol/src/lib/xmtp/xmtp.interface.ts`

**Step 1: Create the MessagingStore interface**

```typescript
/**
 * Storage contract required by the XMTP messaging layer.
 * Implementations provide database access without the lib knowing about the ORM.
 */
export interface MessagingStore {
  /** Retrieve decrypted wallet key for a user. Returns null if no wallet exists. */
  getWalletKey(userId: string): Promise<{ privateKey: string; walletAddress: string } | null>;

  /** Ensure a user has a wallet. Generates one if missing. */
  ensureWallet(userId: string): Promise<void>;

  /** Store the XMTP inbox ID for a user after client creation. */
  setInboxId(userId: string, inboxId: string): Promise<void>;

  /** Get non-sensitive XMTP identity info (wallet address + inbox ID). */
  getPublicInfo(userId: string): Promise<{ walletAddress: string | null; xmtpInboxId: string | null } | null>;

  /** Get all hidden conversations for a user. */
  getHiddenConversations(userId: string): Promise<{ conversationId: string; hiddenAt: Date }[]>;

  /** Get the hidden-at timestamp for a specific conversation, or null if not hidden. */
  getHiddenAt(userId: string, conversationId: string): Promise<Date | null>;

  /** Mark a conversation as hidden (upsert). */
  hideConversation(userId: string, conversationId: string): Promise<void>;

  /** Resolve XMTP inbox IDs to user records (id, name, avatar). */
  resolveUsersByInboxIds(inboxIds: string[]): Promise<Map<string, { id: string; name: string; avatar: string | null }>>;
}
```

**Step 2: Commit**

```bash
git add protocol/src/lib/xmtp/xmtp.interface.ts
git commit -m "refactor: add MessagingStore interface for XMTP lib layer"
```

---

### Task 2: Create `lib/xmtp/xmtp.crypto.ts`

**Files:**
- Create: `protocol/src/lib/xmtp/xmtp.crypto.ts`
- Reference: `protocol/src/services/wallet.service.ts` (source of crypto logic to extract)

**Step 1: Extract pure crypto functions**

Move all crypto logic from `wallet.service.ts` into this file. Every function takes its dependencies as parameters (e.g., `masterKey`) — no `process.env` reads.

```typescript
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { createCipheriv, createDecipheriv, randomBytes, hkdfSync } from 'node:crypto';

/** Encrypt a private key with AES-256-GCM. Returns `iv:tag:ciphertext` hex string. */
export function encryptKey(privateKey: string, masterKey: Buffer): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', masterKey, iv);
  const encrypted = Buffer.concat([cipher.update(privateKey, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('hex')}:${tag.toString('hex')}:${encrypted.toString('hex')}`;
}

/** Decrypt an `iv:tag:ciphertext` blob back to the private key. */
export function decryptKey(blob: string, masterKey: Buffer): string {
  const [ivHex, tagHex, encHex] = blob.split(':');
  const decipher = createDecipheriv('aes-256-gcm', masterKey, Buffer.from(ivHex, 'hex'));
  decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
  return decipher.update(Buffer.from(encHex, 'hex'), undefined, 'utf8') + decipher.final('utf8');
}

/** Derive a 32-byte XMTP DB encryption key via HKDF-SHA256. */
export function deriveDbEncryptionKey(userId: string, masterKey: Buffer): Uint8Array {
  return new Uint8Array(hkdfSync('sha256', masterKey, userId, 'user-xmtp-db', 32));
}

/** Generate a new Ethereum wallet. Returns address and encrypted private key. */
export function generateWallet(masterKey: Buffer): { address: string; encryptedKey: string } {
  const privateKey = generatePrivateKey();
  const account = privateKeyToAccount(privateKey);
  return {
    address: account.address,
    encryptedKey: encryptKey(privateKey, masterKey),
  };
}
```

**Step 2: Commit**

```bash
git add protocol/src/lib/xmtp/xmtp.crypto.ts
git commit -m "refactor: extract XMTP crypto functions into lib/xmtp"
```

---

### Task 3: Create `lib/xmtp/xmtp.client.ts`

**Files:**
- Create: `protocol/src/lib/xmtp/xmtp.client.ts`
- Reference: `protocol/src/adapters/xmtp.adapter.ts` (source of SDK logic to extract)

**Step 1: Extract stateless XMTP SDK wrappers**

All functions receive their dependencies (Client instance, config) as parameters. No caching, no state.

```typescript
import { Client, type Signer, isText } from '@xmtp/node-sdk';
import { toBytes } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

export type XmtpEnv = 'dev' | 'production' | 'local';

/** Create an XMTP Signer from an Ethereum private key. */
export function createSigner(privateKey: `0x${string}`): Signer {
  const account = privateKeyToAccount(privateKey);
  return {
    type: 'EOA' as const,
    getIdentifier: () => ({
      identifier: account.address.toLowerCase(),
      identifierKind: 0 as const,
    }),
    signMessage: async (message: string) => {
      const sig = await account.signMessage({ message });
      return toBytes(sig);
    },
  };
}

/** Create and return an XMTP Client instance. */
export async function createXmtpClient(
  signer: Signer,
  dbEncryptionKey: Uint8Array,
  env: XmtpEnv,
  dbPath: (inboxId: string) => string,
): Promise<Client> {
  return Client.create(signer, { env, dbEncryptionKey, dbPath });
}

/** Find an existing DM conversation by peer inbox ID. Returns conversation ID or null. */
export async function findDm(client: Client, peerInboxId: string): Promise<string | null> {
  await client.conversations.syncAll();
  const dm = await client.conversations.getDmByInboxId(peerInboxId);
  return dm?.id ?? null;
}

/** Create a DM conversation with a peer. Returns conversation ID. */
export async function createDm(client: Client, peerInboxId: string): Promise<string> {
  await client.conversations.syncAll();
  const dm = await client.conversations.createDm(peerInboxId);
  return dm.id;
}

/** Extract text content from an XMTP message. */
export function extractText(msg: { content: unknown }): string {
  if (isText(msg as any)) return msg.content as string;
  if (typeof msg.content === 'string') return msg.content;
  return '';
}
```

**Step 2: Commit**

```bash
git add protocol/src/lib/xmtp/xmtp.client.ts
git commit -m "refactor: extract stateless XMTP client helpers into lib/xmtp"
```

---

### Task 4: Create `lib/xmtp/index.ts` barrel export

**Files:**
- Create: `protocol/src/lib/xmtp/index.ts`

**Step 1: Create barrel export**

```typescript
export type { MessagingStore } from './xmtp.interface';
export { encryptKey, decryptKey, deriveDbEncryptionKey, generateWallet } from './xmtp.crypto';
export { createSigner, createXmtpClient, findDm, createDm, extractText, type XmtpEnv } from './xmtp.client';
```

**Step 2: Commit**

```bash
git add protocol/src/lib/xmtp/index.ts
git commit -m "refactor: add lib/xmtp barrel export"
```

---

### Task 5: Create `adapters/messaging.adapter.ts`

**Files:**
- Create: `protocol/src/adapters/messaging.adapter.ts`
- Reference: `protocol/src/adapters/xmtp.adapter.ts` (being replaced)

**Step 1: Implement the adapter with constructor injection**

The adapter imports only from `lib/xmtp`. It receives a `MessagingStore` via constructor and a config object for env/paths/masterKey. It owns the client cache.

```typescript
import { Client } from '@xmtp/node-sdk';
import { mkdirSync } from 'fs';
import path from 'path';

import { createSigner, createXmtpClient, findDm, createDm, deriveDbEncryptionKey, type XmtpEnv } from '../lib/xmtp';
import type { MessagingStore } from '../lib/xmtp';
import { log } from '../lib/log';

const logger = log.adapter.from('messaging');

export interface MessagingAdapterConfig {
  xmtpEnv: XmtpEnv;
  xmtpDbDir: string;
  walletMasterKey: Buffer;
}

/**
 * Messaging adapter wrapping XMTP SDK operations.
 * Receives a MessagingStore for database access via constructor injection.
 */
export class MessagingAdapter {
  private readonly userClients = new Map<string, Client>();

  constructor(
    private readonly store: MessagingStore,
    private readonly config: MessagingAdapterConfig,
  ) {
    mkdirSync(config.xmtpDbDir, { recursive: true });
  }

  /** Get the MessagingStore (for service-layer access to store methods). */
  getStore(): MessagingStore {
    return this.store;
  }

  /** Get or create an XMTP client for a user. Caches per userId. */
  async getUserClient(userId: string): Promise<Client | null> {
    const cached = this.userClients.get(userId);
    if (cached) return cached;

    let keys = await this.store.getWalletKey(userId);
    if (!keys) {
      await this.store.ensureWallet(userId);
      keys = await this.store.getWalletKey(userId);
      if (!keys) {
        logger.warn('[getUserClient] No wallet found after generation', { userId });
        return null;
      }
    }

    const signer = createSigner(keys.privateKey as `0x${string}`);
    const dbEncryptionKey = deriveDbEncryptionKey(userId, this.config.walletMasterKey);
    const { xmtpEnv, xmtpDbDir } = this.config;

    const client = await createXmtpClient(
      signer,
      dbEncryptionKey,
      xmtpEnv,
      (inboxId) => path.join(xmtpDbDir, `${xmtpEnv}-${inboxId}`),
    );

    await this.store.setInboxId(userId, client.inboxId);
    this.userClients.set(userId, client);
    logger.info('[getUserClient] Created client', { userId, inboxId: client.inboxId });
    return client;
  }

  /** Evict a cached XMTP client. */
  evictUserClient(userId: string): void {
    this.userClients.delete(userId);
  }

  /** Find an existing DM between two users. Returns conversation ID or null. */
  async findExistingDm(userAId: string, userBId: string): Promise<string | null> {
    const peerInfo = await this.store.getPublicInfo(userBId);
    if (!peerInfo?.xmtpInboxId) return null;

    const client = await this.getUserClient(userAId);
    if (!client) return null;

    return findDm(client, peerInfo.xmtpInboxId);
  }

  /** Get or create a DM between two users. Ensures peer has a wallet. Returns conversation ID or null. */
  async getOrCreateDm(userAId: string, userBId: string): Promise<string | null> {
    await this.store.ensureWallet(userBId);
    let peerInfo = await this.store.getPublicInfo(userBId);

    if (!peerInfo?.xmtpInboxId) {
      const peerClient = await this.getUserClient(userBId);
      if (!peerClient) {
        logger.warn('[getOrCreateDm] Could not create peer client', { userBId });
        return null;
      }
      peerInfo = await this.store.getPublicInfo(userBId);
    }

    if (!peerInfo?.xmtpInboxId) {
      logger.warn('[getOrCreateDm] Peer has no inbox ID', { userBId });
      return null;
    }

    const client = await this.getUserClient(userAId);
    if (!client) return null;

    const dmId = await createDm(client, peerInfo.xmtpInboxId);
    logger.info('[getOrCreateDm] DM ready', { dmId, userAId, userBId });
    return dmId;
  }
}
```

**Step 2: Commit**

```bash
git add protocol/src/adapters/messaging.adapter.ts
git commit -m "refactor: add MessagingAdapter with constructor-injected store"
```

---

### Task 6: Create `services/messaging.service.ts`

**Files:**
- Create: `protocol/src/services/messaging.service.ts`
- Reference: `protocol/src/controllers/xmtp.controller.ts` (extracting business logic from here)

**Step 1: Implement the service**

The service imports only from the adapter. It contains all business logic currently in the controller: conversation listing with hidden filtering, message retrieval, send orchestration, SSE streaming.

```typescript
import type { MessagingAdapter } from '../adapters/messaging.adapter';
import { extractText } from '../lib/xmtp';
import { log } from '../lib/log';

const logger = log.service.from('messaging');

export interface ConversationSummary {
  groupId: string;
  name: string;
  peerUserId: string | null;
  peerAvatar: string | null;
  lastMessage: { content: string; sentAt: string } | null;
  updatedAt: string | null;
}

export interface Message {
  id: string;
  senderInboxId: string;
  content: string;
  sentAt: string | undefined;
}

/**
 * Business logic for messaging.
 * Handles conversation listing, message filtering, send orchestration, and streaming.
 */
export class MessagingService {
  constructor(private readonly adapter: MessagingAdapter) {}

  /** List conversations for a user with hidden-message filtering and peer resolution. */
  async listConversations(userId: string): Promise<ConversationSummary[]> {
    const client = await this.adapter.getUserClient(userId);
    if (!client) throw new Error('XMTP client not available');

    const store = this.adapter.getStore();

    await client.conversations.syncAll();
    const dms = await client.conversations.listDms();

    const hiddenRows = await store.getHiddenConversations(userId);
    const hiddenMap = new Map(hiddenRows.map((r) => [r.conversationId, r.hiddenAt]));

    const allInboxIds = new Set<string>();
    const myInboxId = client.inboxId;

    const dmData: {
      dmId: string;
      peerInboxId: string | null;
      lastMessage: { content: string; sentAt: string } | null;
      updatedAt: string | null;
    }[] = [];

    for (const dm of dms) {
      const members = await dm.members();
      const peerMember = members.find((m) => m.inboxId !== myInboxId);
      const peerInboxId = peerMember?.inboxId ?? null;
      if (peerInboxId) allInboxIds.add(peerInboxId);

      const hiddenAt = hiddenMap.get(dm.id);
      const hiddenAtNs = hiddenAt ? BigInt(hiddenAt.getTime()) * BigInt(1_000_000) : null;

      const msgs = await dm.messages({ limit: 10 });
      const visibleMsgs = hiddenAtNs
        ? msgs.filter((m) => m.sentAtNs != null && BigInt(m.sentAtNs.toString()) > hiddenAtNs)
        : msgs;

      if (hiddenAt && visibleMsgs.length === 0) continue;

      const lastText = visibleMsgs.find((m) => extractText(m) !== '');
      dmData.push({
        dmId: dm.id,
        peerInboxId,
        lastMessage: lastText
          ? { content: extractText(lastText), sentAt: lastText.sentAtNs?.toString() ?? '' }
          : null,
        updatedAt: visibleMsgs[0]?.sentAtNs?.toString() ?? null,
      });
    }

    const inboxIdList = [...allInboxIds];
    const inboxToUser = inboxIdList.length
      ? await store.resolveUsersByInboxIds(inboxIdList)
      : new Map();

    return dmData.map((d) => {
      const peer = d.peerInboxId ? inboxToUser.get(d.peerInboxId) : null;
      return {
        groupId: d.dmId,
        name: peer?.name ?? 'Conversation',
        peerUserId: peer?.id ?? null,
        peerAvatar: peer?.avatar ?? null,
        lastMessage: d.lastMessage,
        updatedAt: d.updatedAt,
      };
    });
  }

  /** Get messages for a conversation, filtered by hidden timestamp. */
  async getMessages(userId: string, conversationId: string, limit = 50): Promise<Message[]> {
    const client = await this.adapter.getUserClient(userId);
    if (!client) throw new Error('XMTP client not available');

    const store = this.adapter.getStore();

    await client.conversations.syncAll();
    const conversation = await client.conversations.getConversationById(conversationId);
    if (!conversation) throw new Error('Conversation not found');

    await conversation.sync();
    const allMessages = await conversation.messages({ limit });

    const hiddenAt = await store.getHiddenAt(userId, conversationId);
    const hiddenAtNs = hiddenAt ? BigInt(hiddenAt.getTime()) * BigInt(1_000_000) : null;

    const messages = hiddenAtNs
      ? allMessages.filter((m) => m.sentAtNs != null && BigInt(m.sentAtNs.toString()) > hiddenAtNs)
      : allMessages;

    return messages
      .map((m) => ({
        id: m.id,
        senderInboxId: m.senderInboxId,
        content: extractText(m),
        sentAt: m.sentAtNs?.toString(),
      }))
      .filter((m) => m.content.trim() !== '');
  }

  /** Send a message. Creates DM if needed. Returns conversation ID. */
  async sendMessage(
    userId: string,
    params: { groupId?: string; peerUserId?: string; text: string },
  ): Promise<string> {
    const client = await this.adapter.getUserClient(userId);
    if (!client) throw new Error('XMTP client not available');

    let resolvedGroupId = params.groupId ?? null;

    if (!resolvedGroupId && params.peerUserId) {
      resolvedGroupId = await this.adapter.getOrCreateDm(userId, params.peerUserId);
      if (!resolvedGroupId) throw new Error('Could not create DM');
    }

    if (!resolvedGroupId) throw new Error('groupId or peerUserId is required');

    await client.conversations.syncAll();
    const conversation = await client.conversations.getConversationById(resolvedGroupId);
    if (!conversation) throw new Error('Conversation not found');

    await conversation.sendText(params.text.trim());
    return resolvedGroupId;
  }

  /** Hide a conversation for a user. */
  async hideConversation(userId: string, conversationId: string): Promise<void> {
    const store = this.adapter.getStore();
    await store.hideConversation(userId, conversationId);
  }

  /** Get public XMTP info for a peer user. */
  async getPeerInfo(userId: string): Promise<{ walletAddress: string | null; xmtpInboxId: string | null } | null> {
    const store = this.adapter.getStore();
    return store.getPublicInfo(userId);
  }

  /** Create an SSE ReadableStream for real-time messages. */
  async streamMessages(userId: string): Promise<{ stream: ReadableStream; inboxId: string }> {
    const client = await this.adapter.getUserClient(userId);
    if (!client) throw new Error('XMTP client not available');

    try {
      await client.conversations.syncAll();
    } catch (err) {
      logger.warn('[streamMessages] syncAll failed, continuing', {
        userId,
        error: err instanceof Error ? err.message : String(err),
      });
    }

    const encoder = new TextEncoder();
    const keepAlive = `: keepalive\n\n`;

    const stream = new ReadableStream({
      start(controller) {
        const interval = setInterval(() => {
          try { controller.enqueue(encoder.encode(keepAlive)); } catch { clearInterval(interval); }
        }, 15_000);

        client.conversations
          .streamAllMessages({
            onError: (error) => {
              logger.warn('[streamMessages] Stream onError', {
                userId,
                error: error instanceof Error ? error.message : String(error),
              });
            },
            onFail: () => {
              logger.warn('[streamMessages] Stream onFail — exhausted retries', { userId });
              clearInterval(interval);
              controller.enqueue(encoder.encode(`data: ${JSON.stringify({ error: 'Stream failed' })}\n\n`));
              controller.close();
            },
          })
          .then(async (messageStream) => {
            try {
              for await (const message of messageStream) {
                const content = extractText(message);
                if (!content.trim()) continue;
                const event = {
                  type: 'message',
                  id: message.id,
                  groupId: message.conversationId,
                  senderInboxId: message.senderInboxId,
                  content,
                  sentAt: message.sentAtNs?.toString(),
                };
                controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
              }
            } catch (err) {
              logger.error('[streamMessages] for-await error', {
                userId,
                error: err instanceof Error ? err.message : String(err),
              });
            } finally {
              clearInterval(interval);
              controller.close();
            }
          })
          .catch((err) => {
            logger.error('[streamMessages] streamAllMessages creation failed', {
              userId,
              error: err instanceof Error ? err.message : String(err),
            });
            clearInterval(interval);
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ error: 'Stream init failed' })}\n\n`));
            controller.close();
          });
      },
    });

    return { stream, inboxId: client.inboxId };
  }
}
```

**Step 2: Commit**

```bash
git add protocol/src/services/messaging.service.ts
git commit -m "refactor: add MessagingService with business logic from controller"
```

---

### Task 7: Create `controllers/messaging.controller.ts`

**Files:**
- Create: `protocol/src/controllers/messaging.controller.ts`
- Reference: `protocol/src/controllers/xmtp.controller.ts` (being replaced)

**Step 1: Implement thin HTTP controller**

The controller imports only from the service. All business logic is delegated. The controller handles request parsing and response formatting.

```typescript
import { AuthGuard, type AuthenticatedUser } from '../guards/auth.guard';
import { Controller, Get, Post, UseGuards } from '../lib/router/router.decorators';
import type { MessagingService } from '../services/messaging.service';
import { log } from '../lib/log';

const logger = log.controller.from('messaging');

/**
 * HTTP controller for messaging endpoints.
 * Thin layer: parses requests, delegates to MessagingService, formats responses.
 */
@Controller('/xmtp')
export class MessagingController {
  constructor(private readonly messagingService: MessagingService) {}

  @Get('/conversations')
  @UseGuards(AuthGuard)
  async listConversations(_req: Request, user: AuthenticatedUser) {
    try {
      const conversations = await this.messagingService.listConversations(user.id);
      return Response.json({ conversations });
    } catch (err: any) {
      logger.error('[listConversations] Error', { userId: user.id, error: err.message });
      return Response.json({ error: err.message }, { status: 503 });
    }
  }

  @Post('/messages')
  @UseGuards(AuthGuard)
  async getMessages(req: Request, user: AuthenticatedUser) {
    let body: { groupId?: string; limit?: number };
    try {
      body = (await req.json()) as { groupId?: string; limit?: number };
    } catch {
      return Response.json({ error: 'Invalid request body' }, { status: 400 });
    }

    if (!body.groupId) {
      return Response.json({ error: 'groupId is required' }, { status: 400 });
    }

    try {
      const messages = await this.messagingService.getMessages(user.id, body.groupId, body.limit);
      return Response.json({ messages });
    } catch (err: any) {
      if (err.message === 'Conversation not found') {
        return Response.json({ error: err.message }, { status: 404 });
      }
      logger.error('[getMessages] Error', { userId: user.id, error: err.message });
      return Response.json({ error: err.message }, { status: 503 });
    }
  }

  @Post('/send')
  @UseGuards(AuthGuard)
  async sendMessage(req: Request, user: AuthenticatedUser) {
    let body: { groupId?: string; peerUserId?: string; text?: string };
    try {
      body = (await req.json()) as { groupId?: string; peerUserId?: string; text?: string };
    } catch {
      return Response.json({ error: 'Invalid request body' }, { status: 400 });
    }

    if (!body.text?.trim()) {
      return Response.json({ error: 'text is required' }, { status: 400 });
    }
    if (!body.groupId && !body.peerUserId) {
      return Response.json({ error: 'groupId or peerUserId is required' }, { status: 400 });
    }

    try {
      const groupId = await this.messagingService.sendMessage(user.id, {
        groupId: body.groupId,
        peerUserId: body.peerUserId,
        text: body.text.trim(),
      });
      return Response.json({ success: true, groupId });
    } catch (err: any) {
      logger.error('[sendMessage] Error', { userId: user.id, error: err.message });
      return Response.json({ error: err.message }, { status: 500 });
    }
  }

  @Post('/conversations/delete')
  @UseGuards(AuthGuard)
  async deleteConversation(req: Request, user: AuthenticatedUser) {
    let body: { conversationId?: string };
    try {
      body = (await req.json()) as { conversationId?: string };
    } catch {
      return Response.json({ error: 'Invalid request body' }, { status: 400 });
    }

    if (!body.conversationId) {
      return Response.json({ error: 'conversationId is required' }, { status: 400 });
    }

    await this.messagingService.hideConversation(user.id, body.conversationId);
    return Response.json({ success: true });
  }

  @Post('/peer-info')
  @UseGuards(AuthGuard)
  async peerInfo(req: Request, _user: AuthenticatedUser) {
    let body: { userId?: string };
    try {
      body = (await req.json()) as { userId?: string };
    } catch {
      return Response.json({ error: 'Invalid request body' }, { status: 400 });
    }

    if (!body.userId) {
      return Response.json({ error: 'userId is required' }, { status: 400 });
    }

    const info = await this.messagingService.getPeerInfo(body.userId);
    if (!info) {
      return Response.json({ error: 'User not found' }, { status: 404 });
    }

    return Response.json(info);
  }

  @Get('/stream')
  @UseGuards(AuthGuard)
  async streamMessages(_req: Request, user: AuthenticatedUser) {
    try {
      const { stream, inboxId } = await this.messagingService.streamMessages(user.id);

      const encoder = new TextEncoder();
      const identityEvent = `data: ${JSON.stringify({ type: 'identity', inboxId })}\n\n`;

      const wrappedStream = new ReadableStream({
        start(controller) {
          controller.enqueue(encoder.encode(identityEvent));
          const reader = stream.getReader();
          function pump() {
            reader.read().then(({ done, value }) => {
              if (done) { controller.close(); return; }
              controller.enqueue(value);
              pump();
            }).catch(() => controller.close());
          }
          pump();
        },
      });

      return new Response(wrappedStream, {
        headers: {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          Connection: 'keep-alive',
        },
      });
    } catch (err: any) {
      logger.error('[streamMessages] Error', { userId: user.id, error: err.message });
      return Response.json({ error: err.message }, { status: 503 });
    }
  }
}
```

**Step 2: Commit**

```bash
git add protocol/src/controllers/messaging.controller.ts
git commit -m "refactor: add MessagingController as thin HTTP layer"
```

---

### Task 8: Wire everything in `main.ts` and create MessagingStore implementation

**Files:**
- Modify: `protocol/src/main.ts:1-89` (imports and controller wiring)

**Step 1: Create the MessagingStore Drizzle implementation inline in main.ts wiring**

In `main.ts`, replace the `XmtpController` import and instantiation with the new wiring chain. The `MessagingStore` implementation is created as a plain object using Drizzle queries — it's wiring code, not a reusable module.

Changes to `main.ts`:
1. Remove: `import { XmtpController } from './controllers/xmtp.controller';`
2. Add imports for `MessagingController`, `MessagingAdapter`, `MessagingService`, Drizzle, schema, and crypto functions
3. Replace `controllerInstances.set(XmtpController, new XmtpController())` with the full wiring chain
4. The `MessagingStore` implementation goes in a separate file `protocol/src/adapters/messaging.store.ts` to keep `main.ts` clean

**Files:**
- Create: `protocol/src/adapters/messaging.store.ts`
- Modify: `protocol/src/main.ts`

Create `messaging.store.ts` — the Drizzle-backed implementation of `MessagingStore`:

```typescript
import { eq, and, inArray } from 'drizzle-orm';

import type { MessagingStore } from '../lib/xmtp';
import { generateWallet, decryptKey } from '../lib/xmtp';
import db from '../lib/drizzle/drizzle';
import { users, hiddenConversations } from '../schemas/database.schema';
import { log } from '../lib/log';

const logger = log.adapter.from('messaging.store');

/** Create a Drizzle-backed MessagingStore implementation. */
export function createMessagingStore(masterKey: Buffer): MessagingStore {
  return {
    async getWalletKey(userId) {
      const [user] = await db.select({
        walletEncryptedKey: users.walletEncryptedKey,
        walletAddress: users.walletAddress,
      }).from(users).where(eq(users.id, userId)).limit(1);

      if (!user?.walletEncryptedKey || !user.walletAddress) return null;
      return {
        privateKey: decryptKey(user.walletEncryptedKey, masterKey),
        walletAddress: user.walletAddress,
      };
    },

    async ensureWallet(userId) {
      const [user] = await db.select({ walletAddress: users.walletAddress })
        .from(users).where(eq(users.id, userId)).limit(1);
      if (!user) { logger.warn('[ensureWallet] User not found', { userId }); return; }
      if (user.walletAddress) return;

      const w = generateWallet(masterKey);
      await db.update(users).set({
        walletAddress: w.address,
        walletEncryptedKey: w.encryptedKey,
      }).where(eq(users.id, userId));
      logger.info('[ensureWallet] Wallet generated', { userId });
    },

    async setInboxId(userId, inboxId) {
      await db.update(users).set({ xmtpInboxId: inboxId }).where(eq(users.id, userId));
    },

    async getPublicInfo(userId) {
      const [user] = await db.select({
        walletAddress: users.walletAddress,
        xmtpInboxId: users.xmtpInboxId,
      }).from(users).where(eq(users.id, userId)).limit(1);
      return user ?? null;
    },

    async getHiddenConversations(userId) {
      return db.select({
        conversationId: hiddenConversations.conversationId,
        hiddenAt: hiddenConversations.hiddenAt,
      }).from(hiddenConversations).where(eq(hiddenConversations.userId, userId));
    },

    async getHiddenAt(userId, conversationId) {
      const [row] = await db.select({ hiddenAt: hiddenConversations.hiddenAt })
        .from(hiddenConversations)
        .where(and(
          eq(hiddenConversations.userId, userId),
          eq(hiddenConversations.conversationId, conversationId),
        ))
        .limit(1);
      return row?.hiddenAt ?? null;
    },

    async hideConversation(userId, conversationId) {
      await db.insert(hiddenConversations)
        .values({ userId, conversationId })
        .onConflictDoUpdate({
          target: [hiddenConversations.userId, hiddenConversations.conversationId],
          set: { hiddenAt: new Date() },
        });
    },

    async resolveUsersByInboxIds(inboxIds) {
      const matched = await db.select({
        id: users.id,
        name: users.name,
        avatar: users.avatar,
        xmtpInboxId: users.xmtpInboxId,
      }).from(users).where(inArray(users.xmtpInboxId, inboxIds));

      const map = new Map<string, { id: string; name: string; avatar: string | null }>();
      for (const u of matched) {
        if (u.xmtpInboxId) map.set(u.xmtpInboxId, { id: u.id, name: u.name, avatar: u.avatar });
      }
      return map;
    },
  };
}
```

Update `main.ts` — replace XmtpController wiring:

1. Remove `import { XmtpController } from './controllers/xmtp.controller';`
2. Add:
   ```typescript
   import { MessagingController } from './controllers/messaging.controller';
   import { MessagingAdapter } from './adapters/messaging.adapter';
   import { MessagingService } from './services/messaging.service';
   import { createMessagingStore } from './adapters/messaging.store';
   import path from 'path';
   ```
3. Before `const controllerInstances = ...`, add the wiring:
   ```typescript
   const walletMasterKeyHex = process.env.WALLET_ENCRYPTION_KEY;
   if (!walletMasterKeyHex || walletMasterKeyHex.length !== 64) {
     logger.error('WALLET_ENCRYPTION_KEY must be a 64-char hex string (32 bytes)');
     process.exit(1);
   }
   const walletMasterKey = Buffer.from(walletMasterKeyHex, 'hex');

   const messagingStore = createMessagingStore(walletMasterKey);
   const messagingAdapter = new MessagingAdapter(messagingStore, {
     xmtpEnv: (process.env.XMTP_ENV as 'dev' | 'production' | 'local') || 'dev',
     xmtpDbDir: path.resolve(import.meta.dir, '../.xmtp'),
     walletMasterKey,
   });
   const messagingService = new MessagingService(messagingAdapter);
   ```
4. Replace `controllerInstances.set(XmtpController, new XmtpController())` with:
   ```typescript
   controllerInstances.set(MessagingController, new MessagingController(messagingService));
   ```

**Step 2: Commit**

```bash
git add protocol/src/adapters/messaging.store.ts protocol/src/main.ts
git commit -m "refactor: wire MessagingStore → Adapter → Service → Controller in main.ts"
```

---

### Task 9: Move chat-context endpoint to opportunity controller

**Files:**
- Modify: `protocol/src/controllers/opportunity.controller.ts`
- Reference: `protocol/src/controllers/xmtp.controller.ts:111-152` (chat-context logic)

**Step 1: Add chat-context endpoint to OpportunityController**

Add a `GET /opportunities/chat-context` endpoint to `OpportunityController`. This endpoint queries shared opportunities between two users — it's business logic about opportunities, not messaging. It should use `opportunityService` or query directly (matching the existing pattern in that controller).

The endpoint also needs to find an existing DM ID. Since the controller shouldn't import the adapter, the `MessagingService` should be injected into the controller for this single call, OR the frontend can make two calls. The cleanest approach: the controller accepts an optional `MessagingService` constructor param for the DM lookup.

Alternatively, the frontend already has the groupId in the XMTP context — it can pass it as a query param instead of the backend looking it up. Check the frontend usage:

Looking at `frontend/src/services/xmtp.ts:41-42`:
```typescript
getChatContext: (peerUserId: string) =>
  api.get<XmtpChatContext>(`/xmtp/chat-context?peerUserId=${encodeURIComponent(peerUserId)}`),
```

And the response includes `groupId`. The simplest approach: remove the `groupId` from the response (the frontend already has the conversation context from XMTP), or keep the endpoint on the messaging controller since it's already there and just rename it. Given the user's preference to move it to opportunity, we'll add it there without the DM lookup (the `groupId` field becomes optional/removed).

Add to `OpportunityController`:

```typescript
@Get('/chat-context')
@UseGuards(AuthGuard)
async getChatContext(req: Request, user: AuthenticatedUser) {
  const url = new URL(req.url, `http://${req.headers.get('host') || 'localhost'}`);
  const peerUserId = url.searchParams.get('peerUserId');
  if (!peerUserId) {
    return Response.json({ error: 'peerUserId query param is required' }, { status: 400 });
  }

  const rows = await opportunityService.getSharedOpportunities(user.id, peerUserId);
  return Response.json({ opportunities: rows });
}
```

This requires adding a `getSharedOpportunities` method to `opportunityService`. If that's too invasive, the query can go inline (matching the current controller pattern). Check how the existing controller does it — it queries DB directly. For now, keep the query inline in the controller to minimize scope:

```typescript
import { and, eq, sql, desc } from 'drizzle-orm';
import db from '../lib/drizzle/drizzle';
import { opportunities, users } from '../schemas/database.schema';

// ... inside OpportunityController:

@Get('/chat-context')
@UseGuards(AuthGuard)
async getChatContext(req: Request, user: AuthenticatedUser) {
  const url = new URL(req.url, `http://${req.headers.get('host') || 'localhost'}`);
  const peerUserId = url.searchParams.get('peerUserId');
  if (!peerUserId) {
    return Response.json({ error: 'peerUserId query param is required' }, { status: 400 });
  }

  const rows = await db
    .select()
    .from(opportunities)
    .where(
      and(
        sql`${opportunities.actors} @> ${JSON.stringify([{ userId: user.id }])}::jsonb`,
        sql`${opportunities.actors} @> ${JSON.stringify([{ userId: peerUserId }])}::jsonb`,
        eq(opportunities.status, 'accepted'),
      )
    )
    .orderBy(desc(opportunities.updatedAt));

  const peerUser = await db.select({ name: users.name, avatar: users.avatar })
    .from(users).where(eq(users.id, peerUserId)).limit(1);
  const peer = peerUser[0];

  const opportunityCards = rows.map((opp) => ({
    opportunityId: opp.id,
    headline: (opp.interpretation as any)?.reasoning?.substring(0, 80) ?? 'Connection opportunity',
    summary: (opp.interpretation as any)?.reasoning ?? '',
    peerName: peer?.name ?? 'Someone',
    peerAvatar: peer?.avatar ?? null,
    acceptedAt: opp.updatedAt?.toISOString() ?? null,
  }));

  return Response.json({ opportunities: opportunityCards });
}
```

**Step 2: Update frontend to call new endpoint**

In `frontend/src/services/xmtp.ts`, change `getChatContext` URL from `/xmtp/chat-context` to `/opportunities/chat-context`. The `groupId` field is removed from the response type since the frontend already tracks it via XMTP context.

**Step 3: Commit**

```bash
git add protocol/src/controllers/opportunity.controller.ts frontend/src/services/xmtp.ts
git commit -m "refactor: move chat-context endpoint to opportunity controller"
```

---

### Task 10: Update `auth.ts` to use lib/xmtp instead of wallet.service

**Files:**
- Modify: `protocol/src/lib/auth.ts:9,30-33`

**Step 1: Replace wallet.service import**

The `auth.ts` file calls `ensureUserWallets(user.id)` in the `databaseHooks.user.create.after` hook. This needs to use the `MessagingStore` instead.

The problem: `auth.ts` is a lib file initialized at import time — it can't easily receive the store via constructor injection. The cleanest approach: export a setter function that `main.ts` calls after creating the store.

```typescript
// In auth.ts, replace:
import { ensureUserWallets } from "../services/wallet.service";

// With a lazy reference:
let _ensureWallet: ((userId: string) => Promise<void>) | null = null;

export function setWalletHook(fn: (userId: string) => Promise<void>) {
  _ensureWallet = fn;
}

// In the databaseHooks, replace:
await ensureUserWallets(user.id);
// With:
if (_ensureWallet) await _ensureWallet(user.id);
```

Then in `main.ts`, after creating the store:
```typescript
import { setWalletHook } from './lib/auth';
setWalletHook((userId) => messagingStore.ensureWallet(userId));
```

**Step 2: Commit**

```bash
git add protocol/src/lib/auth.ts protocol/src/main.ts
git commit -m "refactor: replace wallet.service import in auth.ts with injected hook"
```

---

### Task 11: Delete old files

**Files:**
- Delete: `protocol/src/adapters/xmtp.adapter.ts`
- Delete: `protocol/src/services/wallet.service.ts`
- Delete: `protocol/src/controllers/xmtp.controller.ts`
- Delete: `protocol/src/lib/protocol/interfaces/chat.interface.ts` (only had constants)
- Delete: `protocol/src/lib/protocol/support/opportunity.chat-injection.ts` (no-op)

**Step 1: Check for any remaining imports of deleted files**

Search for imports of the deleted files across the codebase. Fix any remaining references.

**Step 2: Check `INDEX_BOT_USER_ID` / `INDEX_BOT_NAME` usage**

If these constants from `chat.interface.ts` are used elsewhere, move them to an appropriate location (e.g., `lib/xmtp/xmtp.interface.ts` or a constants file).

**Step 3: Delete the files and commit**

```bash
git rm protocol/src/adapters/xmtp.adapter.ts
git rm protocol/src/services/wallet.service.ts
git rm protocol/src/controllers/xmtp.controller.ts
git rm protocol/src/lib/protocol/interfaces/chat.interface.ts
git rm protocol/src/lib/protocol/support/opportunity.chat-injection.ts
git commit -m "refactor: remove old xmtp adapter, wallet service, and xmtp controller"
```

---

### Task 12: Verify the build compiles

**Step 1: Run TypeScript check**

```bash
cd protocol && bunx tsc --noEmit
```

Fix any type errors.

**Step 2: Verify the server starts**

```bash
cd protocol && timeout 10 bun run dev || true
```

Check for startup errors in the output.

**Step 3: Commit any fixes**

```bash
git add -A && git commit -m "fix: resolve type errors from messaging refactor"
```

---

### Task 13: Rename frontend service (optional, low priority)

**Files:**
- Rename: `frontend/src/services/xmtp.ts` → keep as-is for now (API paths unchanged at `/xmtp/*`)

Since the backend controller still mounts at `/xmtp` for backward compatibility, the frontend service can remain named `xmtp.ts`. The types and function names are fine — they describe the API contract, not the implementation.

No action needed unless we also want to rename the route prefix.
