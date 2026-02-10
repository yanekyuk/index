# User-to-User Chat vs AI Chat: Implementation Inspection

**Status:** Inspection / reference. Describes current implementation differences.

## Overview

User-to-user chat and AI chat are implemented differently in terms of:
- **Data source & transport**
- **Backend**
- **Connection/permission model**
- **UI components and flows**
- **Floating vs full-page presentation**

---

## 1. Data Source & Transport

| Aspect | User-to-User Chat | AI Chat |
|--------|-------------------|---------|
| **Provider** | Stream Chat (3rd-party real-time messaging) | Custom protocol API (LangGraph) |
| **Transport** | WebSocket + REST via `stream-chat` SDK | HTTP POST + SSE streaming |
| **Messages** | Stored in Stream Chat cloud | Stored in protocol DB (`chat_sessions`, `chat_messages`) |
| **Real-time** | Native (events: `message.new`, `message.updated`, `channel.updated`) | Polling/streaming per request |
| **Context** | `StreamChatContext` | `AIChatContext` |

---

## 2. Backend (Protocol)

### User-to-User Chat (`protocol/src/routes/chat.ts`)

- **Stream Chat** – Token generation, user upsert, channel management
- **Connection model** – Uses `userConnectionEvents` table:
  - `REQUEST` – First message from A to B (pending)
  - `ACCEPT` – B accepts, both can message directly
  - `DECLINE` / `SKIP` – B declines or skips
- **Index approval** – Some indexes require admin approval before messaging
- **API endpoints**:
  - `POST /chat/token` – Stream token
  - `POST /chat/user` – Upsert user in Stream
  - `POST /chat/request` – Send message request (creates channel + first message)
  - `POST /chat/request/respond` – Accept / decline / skip
  - `GET /chat/requests` – Pending message requests
  - `GET /chat/can-message/:targetUserId` – Permission check
  - `POST /chat/suggest-intro` – AI-generated intro

### AI Chat (protocol v2 chat)

- **LangGraph** – `ChatGraphFactory` orchestrates intent, profile, opportunity subgraphs
- **Sessions** – Stored in `chat_sessions` with optional title
- **Messages** – Stored in `chat_messages` (user/assistant)
- **API** – `POST /chat/stream` (SSE), session/title CRUD

---

## 3. Channel Initialization (User-to-User)

ChatView uses a two-phase flow:

1. **Permission check** – `checkCanMessage(userId)`:
   - Connected? → can message directly
   - Pending request + is initiator? → load channel (show “pending”)
   - Else → may need to send a message request

2. **Channel existence** – `client.queryChannels()` (read-only):
   - Exists → `watch()`, load messages, subscribe to events
   - Does not exist → `getOrCreateChannel()` for new conversation, no `watch()` until first message

3. **New conversation** – `isNewConversation`:
   - First message uses `sendMessageRequest()` (backend creates channel + first message)
   - Later messages use `channel.sendMessage()`

---

## 4. Message Request Flow (User-to-User)

- **Requester** – Sends first message via `/chat/request`; sees “Message request pending”
- **Recipient** – Sees request in ChatSidebar (message requests); can Accept / Decline / Skip
- **Admin approval** – If shared index has `requireApproval`, message is held until admin approves
- **Accept** – Channel `pending` cleared; both can message
- **Decline / Skip** – Channel updated; chat closed for recipient

---

## 5. Components Comparison

### ChatView (User-to-User) – 600 lines

**Used by:** `frontend/src/app/u/[id]/chat/page.tsx`

**Behavior:**
- Props: `userId`, `userName`, `userAvatar`, `minimized`, `onClose`, `onBack`
- Uses: `useStreamChat`, `useDiscover` (mutual intents), `useNotifications`
- Features:
  - Pending banners (awaiting admin, requester waiting, accept/decline/skip)
  - Mutual intent count from discover API
  - New conversation vs existing channel handling
  - Message request flow (first message via API, not Stream directly)
  - Optimistic updates, `channel.sendMessage` for direct messages
- UI: Header (avatar, name, mutual intents, Back), pending banners, messages, input
- Messages: `max-w-[75%]`, ReactMarkdown, `prose prose-sm prose-invert`

### ChatWindow (Floating Variant) – 310 lines

**Used by:** nothing (not imported)

**Behavior:**
- Simpler: no `checkCanMessage`, no message requests, no pending banners
- Always uses `getOrCreateChannel` + `watch()` (assumes connected)
- Messages: plain text (`whitespace-pre-wrap`), no ReactMarkdown
- Layout: `h-full overflow-hidden`, compact header (Back + avatar + name + Close)
- Likely designed for floating use (compact, Close button)

### AI Chat Page (`/chat`) – 249 lines

**Behavior:**
- Uses `AIChatContext` (messages, session, streaming)
- Title bar with Sparkles, editable session title
- ThinkingDropdown for assistant reasoning
- Empty state: generic.png, “Ask me anything”
- Messages: `max-w-[80%]`, `chat-markdown` / `chat-markdown-invert`
- Input: card with `Input`, circular Send button

---

## 6. Floating Chat Infrastructure (Unused)

**StreamChatContext:**
- `openChats: ChatWindow[]` – List of open chats (max 3)
- `activeChatId` – Which chat is active
- `openChat()` – Add to `openChats`, set `activeChatId`
- `closeChat()` – Remove from `openChats`
- `toggleMinimize()` – Toggle `minimized` on a chat

**Observation:** Nothing in the app reads `openChats` to render floating windows. The UI that would map `openChats` to bottom-right ChatWindow components is missing. `openChat` is still called (e.g. ChatSidebar, ConnectionActions, u/[id]/chat page) before `router.push`, but only for sidebar/context state; no floating UI is rendered.

---

## 7. Entry Points

| Entry | Action |
|-------|--------|
| ConnectionActions “Message” | `openChat()` → `router.push(/u/[userId]/chat)` |
| ChatSidebar channel click | `openChat()` → `router.push(/u/[userId]/chat)` |
| u/[id]/chat page load | Fetches user → `openChat()` → renders `<ChatView />` |
| Header “Chat” | `router.push(/chat)` (AI chat) |
| Sidebar (on /chat) | List of AI sessions; click → `/chat?sessionId=...` |

---

## 8. ChatSidebar Status

`ChatSidebar` exists but is **not rendered** anywhere. It would show:
- Message requests (Accept/Decline/Skip)
- Conversation list (channels)
- Active chat highlighting via `activeChatUserId` from route params

InboxContent only references it in a comment (`setGlobalInboxState` for ChatSidebar). The sidebar is never included in the layout.

---

## 9. Differences Summary

| Feature | User-to-User | AI Chat |
|---------|--------------|---------|
| Backend | Stream Chat + protocol routes | Protocol v2 + LangGraph |
| Connection model | REQUEST → ACCEPT/DECLINE/SKIP | N/A |
| Admin approval | Yes (per index) | N/A |
| Mutual intents | Yes (discover API) | N/A |
| Pending banners | Yes | N/A |
| Message format | Stream `MessageResponse` | `{ role, content }` |
| Streaming | No (real-time events) | Yes (SSE tokens) |
| Thinking/reasoning | No | Yes (ThinkingDropdown) |
| Session title | No | Yes |
| Rendered where | `/u/[id]/chat` (full page) | `/chat` (full page) |
| Floating UI | Planned but not implemented | No |

---

## 10. Conclusion for Plan

Before removing floating chat infrastructure:

1. **ChatView** is the main user-to-user UI (600 lines, rich flows).
2. **ChatWindow** is a simpler, compact variant for floating use; it is unused.
3. **Floating rendering** – The code that would render `openChats` as bottom-right windows is not present.
4. **ChatSidebar** – Conversation list + message requests exists but is never rendered.

If the goal is to remove the floating chat and unify UI with AI chat:
- Keep ChatView logic (Stream Chat, message requests, pending states).
- Apply AI chat styling/layout to ChatView.
- Remove ChatWindow, `openChats`, `toggleMinimize`, and related state.
- Optionally wire ChatSidebar into the layout if a conversation list is desired.
