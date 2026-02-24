# XMTP → Messaging Refactor Design

## Problem

The current XMTP implementation violates the project's layering rules:
- `xmtp.adapter.ts` imports from `wallet.service.ts` (adapter → service, forbidden)
- `xmtp.controller.ts` imports directly from adapter and service (should go through service only)
- No protocol interface exists for messaging
- XMTP-specific naming leaks into layers that shouldn't care about the underlying protocol
- `wallet.service.ts` mixes crypto utilities with DB operations

## Layering Rules

```text
Controller → Service → Adapter → Lib
   (HTTP)   (business)  (infra)   (pure SDK)
```

- Services import only from adapters
- Adapters import only from libs
- Libs import only external SDKs (viem, @xmtp/node-sdk), node builtins (crypto), and logging
- DB access in adapters is via dependency injection (not direct drizzle import)

## Design

### Layer 1: `lib/xmtp/`

Pure XMTP SDK operations and crypto. No DB, no infrastructure imports.

**`xmtp.interface.ts`** — Storage contract the lib defines for consumers to implement:

```typescript
export interface MessagingStore {
  getWalletKey(userId: string): Promise<{ privateKey: string; walletAddress: string } | null>;
  ensureWallet(userId: string): Promise<void>;
  setInboxId(userId: string, inboxId: string): Promise<void>;
  getPublicInfo(userId: string): Promise<{ walletAddress: string | null; xmtpInboxId: string | null } | null>;

  getHiddenConversations(userId: string): Promise<{ conversationId: string; hiddenAt: Date }[]>;
  getHiddenAt(userId: string, conversationId: string): Promise<Date | null>;
  hideConversation(userId: string, conversationId: string): Promise<void>;

  resolveUsersByInboxIds(inboxIds: string[]): Promise<Map<string, { id: string; name: string; avatar: string | null }>>;
}
```

**`xmtp.crypto.ts`** — Pure crypto functions:
- `generateWallet()` → `{ address, encryptedKey }`
- `encryptKey(privateKey, masterKey)` / `decryptKey(blob, masterKey)`
- `deriveDbEncryptionKey(userId, masterKey)` → `Uint8Array`

**`xmtp.client.ts`** — Stateless XMTP SDK wrappers (take `Client` as parameter):
- `createSigner(privateKey)` → `Signer`
- `createXmtpClient(signer, dbEncryptionKey, env, dbDir)` → `Client`
- `findDm(client, peerInboxId)` → `string | null`
- `createDm(client, peerInboxId)` → `string`
- `getMessages(client, conversationId, limit)` → messages
- `sendMessage(client, conversationId, text)` → void

### Layer 2: `adapters/messaging.adapter.ts`

Imports only from `lib/xmtp/`. Receives `MessagingStore` via constructor injection.

- Constructor: `new MessagingAdapter(store: MessagingStore)`
- Owns client cache (`Map<string, Client>`)
- `getUserClient(userId)` — fetches key via store → lib decrypt → lib create client → caches
- `getOrCreateDm(userAId, userBId)` — ensures wallets via store, resolves inbox IDs, calls lib
- `findExistingDm(userAId, userBId)` — resolves peer info via store, calls lib
- `evictUserClient(userId)` — cache eviction

### Layer 3: `services/messaging.service.ts`

Imports only from adapter.

- Constructor: `new MessagingService(store: MessagingStore, config: MessagingAdapterConfig)` — creates `MessagingAdapter` internally
- `listConversations(userId)` — client from adapter, hidden-message filtering, peer resolution
- `getMessages(userId, conversationId, limit)` — messages + hidden-timestamp filtering
- `sendMessage(userId, groupId?, peerUserId?, text)` — orchestrates DM creation + send
- `hideConversation(userId, conversationId)` — delegates to adapter store
- `getPeerInfo(userId)` — delegates to adapter store
- `streamMessages(userId)` — returns SSE ReadableStream

### Layer 4: `controllers/messaging.controller.ts`

Imports only from service. Thin HTTP layer — parse request, call service, return response.

Renamed from `xmtp.controller.ts`. Same endpoints, but all logic delegated to service.

### Wiring (main.ts)

Create `MessagingStore` implementation (backed by Drizzle), inject into service → controller.

Wallet provisioning for new users uses a lazy hook to avoid circular imports between `auth.ts` and the messaging layer. `auth.ts` exports `setWalletHook(fn)` instead of importing `wallet.service` directly. In `main.ts`, after creating the store:

```typescript
setWalletHook((userId) => messagingStore.ensureWallet(userId));
```

This lets the Better Auth `user.create.after` hook call the injected function without `auth.ts` knowing about the messaging adapter.

## Migrations

### Chat Context Endpoint

`GET /xmtp/chat-context` moves to the opportunity controller. It queries opportunities between two users — not a messaging concern.

### Deletions

- `wallet.service.ts` — deleted (crypto → `lib/xmtp/crypto`, DB ops → `MessagingStore` implementation)
- `xmtp.adapter.ts` — replaced by `messaging.adapter.ts`
- `chat.interface.ts` — constants relocated to `lib/xmtp/` or inlined

### Frontend

`frontend/src/services/xmtp.ts` — rename to `messaging.ts`, update endpoint paths if any change.
