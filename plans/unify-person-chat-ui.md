# Unify Person Chat UI and Remove Pop-up Chat

## Summary

1. **Remove pop-up chat infrastructure** – The floating bottom-right chat widget no longer exists in the codebase, but leftover logic and components remain. Remove that dead code.

**Inspection done:** See [`user-chat-vs-ai-chat-inspection.md`](./user-chat-vs-ai-chat-inspection.md) for a detailed comparison of user-to-user chat vs AI chat before making changes.
2. **Unify person chat UI with AI chat** – Make the person-to-person ChatView use the same layout and styling as the AI chat page.
3. **Skip MessageBubble** – Do not add a new MessageBubble component. Reuse the same styles in ChatView directly.

---

## Part 1: Remove Pop-up Chat Infrastructure

### What Exists (Dead Code)

- **StreamChatContext**: `openChats`, `toggleMinimize`, `activeChatId`, `setActiveChat` – nothing reads these to render floating chat windows
- **ChatWindow.tsx** – Not imported anywhere; compact chat UI intended for floating windows
- **ChatView/ChatWindow** – Both have a `minimized` prop that is ignored

### Changes

| File | Action |
|------|--------|
| `frontend/src/components/chat/ChatWindow.tsx` | **Delete** – unused |
| `frontend/src/contexts/StreamChatContext.tsx` | Remove `openChats`, `toggleMinimize`, `activeChatId`, `setActiveChat`; simplify `openChat`, `closeChat`, `clearActiveChat` to no-ops (or remove if callers can just use `router.push` / `router.back`) |
| `frontend/src/components/chat/ChatView.tsx` | Remove `minimized` prop from interface and usage |
| `frontend/src/app/u/[id]/chat/page.tsx` | Stop passing `minimized={false}` to ChatView |

### StreamChatContext Simplification

- **openChat**: Called before `router.push` to a chat page. Can be a no-op or a stub that does nothing. Callers (ChatSidebar, ConnectionActions, u/[id]/chat) will still work because they navigate via `router.push`.
- **closeChat**: Called on handleClose in u/[id]/chat page – used when user closes; can be no-op.
- **clearActiveChat**: Called by ChatView handleBack – can be no-op.

Alternatively, keep `openChat` and `closeChat` as thin stubs for now to avoid changing all call sites; they simply won’t maintain `openChats` or `activeChatId` anymore.

---

## Part 2: Unify ChatView UI with AI Chat Page

### Reference: AI Chat Page Layout ([`frontend/src/app/chat/page.tsx`](frontend/src/app/chat/page.tsx))

- **Title bar card**: `bg-white border border-gray-800 rounded-sm shadow-lg`, Sparkles icon, editable title
- **Messages area**: `flex-1 min-h-0 overflow-y-auto p-4`, message bubbles `max-w-[80%]`, `chat-markdown` / `chat-markdown-invert`
- **Input card**: Same card styling, `Input` component, circular send button (`h-9 w-9 rounded-full bg-black`)

### ChatView Updates ([`frontend/src/components/chat/ChatView.tsx`](frontend/src/components/chat/ChatView.tsx))

- **Header**: Wrap in the same card style as AI chat. Keep: avatar, name, mutual intent count, Back button. No need for Sparkles (person chat, not AI).
- **Messages**: Use `max-w-[80%]` (instead of 75%), add `chat-markdown` / `chat-markdown-invert` classes, match bubble styling.
- **Input**: Same card wrapper as AI chat, same input and send button styling.
- **Preserve**: Pending message request banners, accept/decline/skip, message request flow, mutual intent count.

---

## Implementation Order

1. Delete `ChatWindow.tsx`
2. Simplify `StreamChatContext` (remove pop-up-related state and handlers)
3. Remove `minimized` from ChatView and its usage
4. Restyle ChatView to match AI chat layout and components
