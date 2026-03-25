---
trigger: "Write comprehensive API reference documentation for all protocol endpoints"
type: docs
branch: docs/api-reference
created: 2026-03-26
version-bump: none
---

## Related Files
- `protocol/src/controllers/auth.controller.ts`
- `protocol/src/controllers/chat.controller.ts`
- `protocol/src/controllers/conversation.controller.ts`
- `protocol/src/controllers/debug.controller.ts`
- `protocol/src/controllers/index.controller.ts`
- `protocol/src/controllers/integration.controller.ts`
- `protocol/src/controllers/intent.controller.ts`
- `protocol/src/controllers/link.controller.ts`
- `protocol/src/controllers/opportunity.controller.ts`
- `protocol/src/controllers/profile.controller.ts`
- `protocol/src/controllers/queues.controller.ts`
- `protocol/src/controllers/storage.controller.ts`
- `protocol/src/controllers/subscribe.controller.ts`
- `protocol/src/controllers/unsubscribe.controller.ts`
- `protocol/src/controllers/user.controller.ts`
- `protocol/src/lib/router/router.decorators.ts`
- `protocol/src/guards/auth.guard.ts`
- `protocol/src/guards/debug.guard.ts`
- `protocol/src/main.ts`

## Relevant Docs
None — knowledge base does not cover this area yet.

## Scope
Write comprehensive API reference documentation (`docs/api-reference.md`) covering all protocol endpoints:

1. **Read all 15 controllers** — extract every route (method, path, guards, handler name)
2. **Document each endpoint** — HTTP method, full path, authentication requirements, request body/params, response format
3. **Group by domain** — Auth, Chat, Conversation, Debug, Index, Integration, Intent, Link, Opportunity, Profile, Queues, Storage, Subscribe/Unsubscribe, User
4. **Include authentication patterns** — AuthGuard (session-based), DebugGuard (dev/admin only), public routes (unsubscribe)
5. **Document SSE streaming** — chat and conversation endpoints that use Server-Sent Events
6. **Note request/response types** — Zod schemas, path params, query params where defined in controllers
7. **Keep factual** — only document what exists in the code, no aspirational endpoints
