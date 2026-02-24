# XMTP Client-Side Migration & Index Bot Design

## Overview

Move XMTP from server-side to client-side. Users connect their own wallets and run XMTP directly in the browser. The server's XMTP role shrinks to operating a single Index Bot that posts opportunity messages into group conversations.

## Motivation

The current architecture stores user wallet private keys server-side (encrypted with a master key the server holds). This defeats XMTP's core value proposition of end-to-end encryption — the server can read every message. Moving XMTP client-side restores proper E2E encryption where only participants can read messages.

## Architecture Shift

| Concern | Current (server-side) | New (client-side) |
|---|---|---|
| User XMTP client | Server creates/manages | Browser creates via wallet signing |
| Send messages | `POST /xmtp/send` → server sends | Browser SDK sends directly |
| Receive/stream | `GET /xmtp/stream` → SSE from server | Browser SDK streams directly |
| Message history | Server fetches from XMTP | Browser SDK fetches locally |
| User keys | Server-generated, encrypted in DB | User's wallet, never leaves device |
| Bot messages | N/A | Server-side bot client sends to groups |

## Conversation Model

Every user-to-user conversation is an XMTP **group** with 3 members: User A + User B + Index Bot. The bot posts structured opportunity introductions and follow-ups. There is one group per user pair regardless of how many indexes they share.

Indexes enable discovery (visibility between users) but are not a functional part of the conversation model. As long as users share any index, they are visible to each other for opportunity detection.

## Auth Flow

- Users log in with email/social (Better Auth — unchanged).
- Wallet connection is an additional optional step (settings page or prompted on first chat open).
- Users connect their Ethereum wallet (MetaMask, WalletConnect, etc.).
- Messaging features require a connected wallet.
- Cross-device works naturally — same wallet on any device creates a new XMTP installation linked to the same inbox.

## Index Bot (Server-Side)

### Identity

- Single global bot identity for the entire system.
- Bot wallet private key stored as `INDEX_BOT_PRIVATE_KEY` environment variable.
- XMTP DB encryption key derived from it via HKDF.
- Bot's `inboxId` discovered at client initialization, cached in memory.

### Bot Service

```typescript
class BotService {
  private client: Client | null;

  async getOrCreateGroup(userAId: string, userBId: string): Promise<string>;
  async sendOpportunityIntro(groupId: string, opportunity: Opportunity): Promise<void>;
  async sendOpportunityUpdate(groupId: string, opportunity: Opportunity): Promise<void>;
}
```

### Trigger Flow

When an opportunity transitions to `pending` or `accepted`:

1. `queueOpportunityNotification()` fires (existing)
2. Notification queue worker sends email (existing)
3. **NEW**: Worker also sends XMTP bot message:
   a. Look up both users' `xmtpInboxId` from users table
   b. If either user hasn't registered → skip XMTP, email only
   c. Look up `conversations` table for existing group
   d. If no group → bot creates one via `createGroup([userAInboxId, userBInboxId])`
   e. Store `xmtpGroupId` in `conversations` table
   f. Bot sends structured intro message to the group

### Message Format

Bot sends structured text with a type prefix:

```
[index:opportunity]
{"opportunityId":"...","headline":"...","summary":"...","actors":[...]}

[index:opportunity_update]
{"opportunityId":"...","status":"accepted","updatedAt":"..."}
```

Frontend detects the prefix on messages from the bot's `inboxId` and renders `SystemMessageCard` instead of a plain text bubble.

## Database Changes

### New `conversations` Table

Tracks the mapping between user pairs and their XMTP group:
- `id` (PK)
- `userAId` (FK → users.id)
- `userBId` (FK → users.id)
- `xmtpGroupId` (text)
- `createdAt` (timestamp)
- Unique constraint on `(userAId, userBId)` (normalized: userA < userB alphabetically)

### User Wallet Registration

Existing columns on `users` table (`walletAddress`, `xmtpInboxId`) are reused:
- `walletAddress` — set when user connects their wallet
- `xmtpInboxId` — set when XMTP client initializes client-side

## Frontend Architecture

### Wallet Connection

- Add wallet connect library (`wagmi` + `viem` + WalletConnect).
- UI in user settings + prompt on first chat open.
- On connect: register wallet via `POST /users/wallet`, initialize XMTP, register inboxId via `POST /users/xmtp-inbox`.

### Rewritten XMTPContext

- Creates XMTP client in the browser using `@xmtp/browser-sdk` with the wallet as signer.
- Manages conversations, message streaming, and sending entirely client-side.
- No API calls for send/receive/stream.
- Still calls `GET /opportunities/chat-context` for opportunity metadata.

### Conversation List

- `client.conversations.list()` returns all groups.
- Display the other human as the conversation title (filter out bot's inboxId from member list).

### Message Rendering

- Messages from bot's inboxId with `[index:opportunity]` prefix → `SystemMessageCard`
- Messages from bot's inboxId with `[index:opportunity_update]` prefix → update card
- All other messages → normal chat bubbles
- Bot's inboxId provided via `NEXT_PUBLIC_INDEX_BOT_INBOX_ID` env var

## Protocol Endpoints

### Removed

- `POST /xmtp/send`
- `GET /xmtp/messages/:groupId`
- `GET /xmtp/stream`
- `GET /xmtp/conversations`
- `POST /xmtp/find-dm`

### Kept

- `GET /opportunities/chat-context` — opportunity data for conversation UI

### New

- `POST /users/wallet` — register wallet address
- `POST /users/xmtp-inbox` — register XMTP inboxId
- `GET /bot/inbox-id` — frontend fetches bot's inboxId (or use env var)

## Server-Side Cleanup

### Removed

- `MessagingAdapter` — server-side user XMTP clients entirely removed
- `MessagingService` send/stream/getMessages methods
- `MessagingController` — all user-facing XMTP endpoints
- Server-side user wallet generation and key encryption
- `WALLET_ENCRYPTION_KEY` env var
- `.xmtp/` directory with per-user SQLite DBs

### Replaced By

- `BotService` — manages single bot client and group operations
- `BotController` — minimal (`GET /bot/inbox-id`)

## Migration

- Existing DMs are abandoned (no migration, no archive).
- New 3-way groups are created when the bot first needs to message a user pair or when a user opens chat.
- Old server-side XMTP data (user wallets, encrypted keys, SQLite DBs) is cleaned up entirely.
- Users must connect a wallet to use messaging going forward.
