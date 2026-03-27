---
trigger: "IND-199 — Design Index CLI — clarify A2A, H2A, H2H terminology"
type: docs
branch: docs/cli-interaction-design
base-branch: dev
created: 2026-03-27
version-bump: none
linear-issue: IND-199
---

## Related Files
- protocol/src/controllers/chat.controller.ts (/api/chat/*, ChatSessionService, SSE streaming)
- protocol/src/controllers/conversation.controller.ts (/api/conversations/*, ConversationService, TaskService)
- protocol/src/services/chat.service.ts (ChatSessionService)
- protocol/src/services/conversation.service.ts (ConversationService)
- protocol/src/services/negotiation.service.ts (A2A negotiation uses conversation infrastructure)
- protocol/src/adapters/database.adapter.ts (ChatDatabaseAdapter, ConversationDatabaseAdapter)
- protocol/src/schemas/conversation.schema.ts (shared DB tables: conversations, messages, tasks, artifacts)
- protocol/src/lib/protocol/graphs/chat.graph.ts (H2A discovery chat graph)
- protocol/src/lib/protocol/states/chat.state.ts
- protocol/src/lib/protocol/agents/chat.agent.ts
- protocol/src/lib/protocol/streamers/chat.streamer.ts
- frontend/src/contexts/ (AIChatContext, AIChatSessionsContext, ConversationContext)

## Relevant Docs
- docs/domain/negotiation.md (A2A protocol, bilateral agent negotiation, conversation integration)
- docs/domain/opportunities.md (discovery triggers including chat-driven)
- docs/design/protocol-deep-dive.md (graphs, agents, tools overview)

## Related Issues
- IND-199 Design Index CLI — clarify A2A, H2A, H2H terminology (Todo)

## Scope
Create a design decision document that clarifies interaction terminology and CLI design for Index Network.

### Deliverables
1. **Terminology decision**: Confirm or refine A2A (Agent-to-Agent), H2A (Human-to-Agent), H2H (Human-to-Human) as the canonical terms for the three interaction patterns
2. **Interaction pattern catalog**: Document each pattern with its current code path, proposed unified path, and CLI mapping
3. **Chat vs Conversations unification proposal**: Document the current dual-system problem (ChatSessionService vs ConversationService over the same DB tables) and propose a unified "conversations" model where interaction type determines behavior
4. **CLI command design**: Choose between the explored patterns (chat-as-verb vs unified target resolution) and document the chosen CLI surface area
5. **Missing patterns**: Address edge cases like human observing A2A, group conversations

### Current state to document
- /api/chat/* — H2A discovery chats (SSE, 2 participants: user + system-agent)
- /api/conversations/* — H2H DMs and A2A negotiations (Redis pub/sub, N participants)
- Both use the same underlying DB tables (conversations, messages, tasks, artifacts)
- ChatDatabaseAdapter is a facade over the same tables ConversationDatabaseAdapter accesses directly
