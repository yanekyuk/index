---
title: "CLI Interaction Design"
type: design
tags: [cli, interactions, a2a, h2a, h2h, conversations, chat, terminology, unification]
created: 2026-03-27
updated: 2026-03-27
---

# CLI Interaction Design

This document establishes canonical terminology for the three interaction patterns in Index Network, catalogs each pattern with its current and proposed code paths, proposes unifying the dual chat/conversation system, and defines the CLI command surface area.

---

## 1. Terminology Decision

Index Network supports three distinct interaction patterns between participants. Each pattern has different transport characteristics, participant counts, and agent involvement. The following terms are adopted as canonical across the codebase, documentation, and CLI.

| Abbreviation | Full Term | Definition |
|---|---|---|
| **H2A** | Human-to-Agent | A user conversing with the system's AI agent. The agent has tool-calling capabilities and can invoke subgraphs (intent creation, opportunity discovery, profile management). Currently the primary interaction mode. |
| **H2H** | Human-to-Human | A direct message between two users. No AI agent participates in the conversation itself, though the system may observe messages for context (with consent). |
| **A2A** | Agent-to-Agent | Two AI agents -- each representing a different user -- communicating autonomously. Currently used for bilateral negotiation where a proposer and responder agent debate match quality. |

### Why these terms

- They are self-explanatory and compose naturally: "H2A session", "A2A negotiation", "H2H DM".
- They map directly to participant types already in the schema (`participantType: 'user' | 'agent'`).
- They avoid overloaded terms like "chat" (which currently means H2A in the codebase but could mean any pattern) and "conversation" (which currently means H2H/A2A but is really the universal container).

### Usage guidelines

- Use the abbreviations in code comments, commit messages, and documentation headings.
- Use the full terms on first reference in any document.
- In the database and API layers, the interaction type is derived from participants -- it is not stored as a separate column. A conversation with one user and one agent participant is H2A; two user participants is H2H; two agent participants is A2A.

---

## 2. Interaction Pattern Catalog

### 2.1 H2A (Human-to-Agent)

**What it is:** A user sends messages to the system's AI agent. The agent reasons over the user's input, calls tools to perform actions (create intents, discover opportunities, manage profiles), and streams responses back via SSE.

**Current code path:**

| Layer | Component | File |
|---|---|---|
| Controller | `ChatController` | `src/controllers/chat.controller.ts` |
| Service | `ChatSessionService` | `src/services/chat.service.ts` |
| DB adapter | `ChatDatabaseAdapter` | `src/adapters/database.adapter.ts` |
| Graph | `ChatGraphFactory` | `src/lib/protocol/graphs/chat.graph.ts` |
| Agent | `ChatAgent` | `src/lib/protocol/agents/chat.agent.ts` |
| Streamer | `ChatStreamer` | `src/lib/protocol/streamers/chat.streamer.ts` |
| State | `ChatGraphState` | `src/lib/protocol/states/chat.state.ts` |

**API surface:**
- `POST /api/chat/message` -- synchronous message processing
- `POST /api/chat/stream` -- SSE streaming with context
- `GET /api/chat/sessions` -- list user sessions
- `POST /api/chat/session` -- get session with messages
- `POST /api/chat/session/delete` -- delete session
- `POST /api/chat/session/title` -- rename session
- `POST /api/chat/session/share` -- generate share token
- `POST /api/chat/session/unshare` -- revoke share token
- `GET /api/chat/shared/:token` -- view shared session (public)
- `POST /api/chat/message/:id/metadata` -- persist trace events

**Transport:** Server-Sent Events (SSE). The client opens a single HTTP connection; the server pushes status, token, routing, subgraph_result, debug_meta, and done events.

**Participants:** Exactly 2 -- one user, one system-agent. The agent identity is implicit (not tracked as a conversation participant row in the current implementation).

### 2.2 H2H (Human-to-Human)

**What it is:** A direct message between two users. Messages are plain text or structured parts. No AI agent participates.

**Current code path:**

| Layer | Component | File |
|---|---|---|
| Controller | `ConversationController` | `src/controllers/conversation.controller.ts` |
| Service | `ConversationService` | `src/services/conversation.service.ts` |
| DB adapter | `ConversationDatabaseAdapter` | `src/adapters/database.adapter.ts` |

**API surface:**
- `GET /api/conversations` -- list conversations
- `POST /api/conversations` -- create conversation with participants
- `POST /api/conversations/dm` -- get or create DM with peer
- `GET /api/conversations/:id/messages` -- get messages (paginated)
- `POST /api/conversations/:id/messages` -- send message
- `PATCH /api/conversations/:id/metadata` -- update metadata
- `DELETE /api/conversations/:id` -- hide conversation
- `GET /api/conversations/stream` -- SSE for real-time events
- `GET /api/conversations/:id/tasks` -- list tasks
- `GET /api/conversations/:id/tasks/:taskId` -- get task
- `GET /api/conversations/:id/tasks/:taskId/artifacts` -- get artifacts

**Transport:** Redis pub/sub for real-time delivery, SSE for browser consumption. Messages are persisted to the conversations/messages tables.

**Participants:** 2 users for DMs. The schema supports N participants for future group conversations.

### 2.3 A2A (Agent-to-Agent)

**What it is:** Two AI agents communicate autonomously on behalf of their respective users. Currently used exclusively for bilateral negotiation.

**Current code path:**

| Layer | Component | File |
|---|---|---|
| Service | `NegotiationService` | `src/services/negotiation.service.ts` |
| DB adapter | `ConversationDatabaseAdapter` | `src/adapters/database.adapter.ts` |
| Graph | `NegotiationGraphFactory` | `src/lib/protocol/graphs/negotiation.graph.ts` |

**API surface:** A2A conversations are created programmatically by the negotiation service. They share the same `/api/conversations` endpoints for reading but are not created through the REST API by users.

**Transport:** Synchronous graph execution. The negotiation graph runs both agents in a turn-based loop within a single graph invocation. No real-time streaming to users (the negotiation happens in the background).

**Participants:** 2 agents, each identified as `agent:{userId}` in the participant table.

### 2.4 Missing Patterns

| Pattern | Description | Status |
|---|---|---|
| **H2A+H2H hybrid** | A group conversation where both humans and the AI agent participate. Users chat with each other while the agent can be invoked (e.g., "@agent find connections between us"). | Not implemented. Requires extending the chat graph to operate within a multi-participant conversation. |
| **A2A observation** | A human observing an A2A conversation in real time. Users could watch their agent negotiate on their behalf, with the option to intervene. | Not implemented. A2A conversations are readable after the fact via `/api/conversations/:id/messages` but have no live streaming. |
| **Group H2H** | More than 2 humans in a conversation. | Schema supports it (N participants). No UI or specific API support yet. |

---

## 3. Chat vs Conversations Unification Proposal

### The problem

The system currently has two parallel conversation systems that operate over the **same database tables**:

1. **ChatSessionService** (`/api/chat/*`) -- manages H2A interactions. Creates conversations and messages through `ChatDatabaseAdapter`, which is a facade over the shared conversation tables. Adds metadata (title, indexId, shareToken) via `conversation_metadata`.

2. **ConversationService** (`/api/conversations/*`) -- manages H2H DMs and A2A negotiations. Accesses the same `conversations`, `messages`, `tasks`, and `artifacts` tables through `ConversationDatabaseAdapter`.

Both adapters read and write the same rows. A chat session IS a conversation row. A chat message IS a message row (with the `parts` column containing a single TextPart). The `ChatDatabaseAdapter` simply wraps `ConversationDatabaseAdapter` calls with session-specific logic (title generation, message ordering, metadata).

This duality creates several problems:

- **Two APIs for the same data.** A conversation created via `/api/chat/stream` is invisible to `/api/conversations` and vice versa, even though they share the same tables.
- **Inconsistent mental model.** Developers must remember that "chat sessions" and "conversations" are the same thing at the database level but different things at the API level.
- **Feature duplication.** Both systems implement message persistence, session listing, and real-time delivery independently.
- **Difficult to extend.** Adding a new interaction pattern (e.g., H2A+H2H hybrid) requires deciding which API surface to extend.

### Proposed unified model

Unify around a single **conversations** API where the **interaction type** (H2A, H2H, A2A) is derived from the participants rather than the endpoint. The current `/api/chat/*` endpoints become convenience wrappers that create conversations with the appropriate participants and invoke the chat graph.

**Core principle:** A conversation is a conversation regardless of who is in it. The participant list determines behavior, not the URL path.

#### Participant-driven behavior

| Participants | Interaction type | Behavior |
|---|---|---|
| 1 user + 1 system-agent | H2A | Messages route through the chat graph. SSE streaming. Tool calling enabled. |
| 2 users | H2H | Messages are persisted and delivered via pub/sub. No agent involvement. |
| 2 agents | A2A | Messages are produced by graph execution. No direct user input. |
| N users + 1 system-agent | H2A+H2H | Messages from users are delivered to all participants. Messages mentioning the agent route through the chat graph. |

#### Migration path

This unification is a refactoring of the API surface, not the database. The underlying tables are already unified. The migration consists of:

1. **Keep `/api/conversations` as the primary API.** Extend it with streaming support for H2A conversations.
2. **Deprecate `/api/chat/*` endpoints** in favor of convenience methods on the conversations API (e.g., `POST /api/conversations/agent` to create or resume an H2A conversation).
3. **Merge ChatDatabaseAdapter into ConversationDatabaseAdapter.** The chat-specific methods (title generation, share tokens, message metadata) become capabilities of the unified adapter, gated by conversation type.
4. **Keep ChatSessionService as a thin orchestrator** for the chat graph invocation, but have it operate on conversations rather than maintaining its own session concept.

#### What stays the same

- The database schema does not change.
- The chat graph, agents, tools, and streamers are unchanged.
- The frontend contexts (`AIChatContext`, `ConversationContext`) continue to work but can be incrementally merged.
- Existing H2H and A2A flows are unchanged.

---

## 4. CLI Command Design

### Design choice: unified target resolution

The CLI uses a **noun-first** command structure where the target (conversation, intent, index, etc.) is the primary command, and the action is a subcommand. This was chosen over the "chat-as-verb" pattern because it scales better as the system grows and avoids ambiguity between "chatting" (H2A) and "messaging" (H2H).

### Command surface

#### Conversations

All interaction types are managed through a unified `conversation` command. The interaction type is determined by the target, not the command.

```
index conversation list                    # List all conversations (H2A, H2H, A2A)
index conversation list --type h2a         # Filter by interaction type
index conversation list --type h2h
index conversation list --type a2a

index conversation start <target>          # Start or resume a conversation
                                           # target = "agent" -> H2A
                                           # target = "@username" -> H2H DM
                                           # target = conversation-id -> resume existing

index conversation show <id>               # Show conversation messages
index conversation show <id> --follow      # Stream new messages in real time

index conversation send <id> <message>     # Send a message in a conversation
index conversation delete <id>             # Delete/hide a conversation
index conversation share <id>              # Generate share link
index conversation unshare <id>            # Revoke share link
```

**Shorthand for common H2A usage:**

```
index chat [message]                       # Start or continue H2A session
                                           # Equivalent to: index conversation start agent
                                           # If message provided, sends it immediately
index chat --session <id> [message]        # Continue specific session
index chat --index <id> [message]          # Scope to an index
```

The `chat` command is syntactic sugar for the most common interaction: talking to the agent. It maps to `conversation start agent` internally.

#### Intents

```
index intent list                          # List user's intents
index intent create <content>              # Create intent from natural language
index intent show <id>                     # Show intent details
index intent archive <id>                  # Archive an intent
index intent assign <intent-id> <index-id> # Assign intent to index
```

#### Indexes

```
index idx list                             # List indexes (abbreviated to avoid clash with binary name)
index idx create <name>                    # Create an index
index idx show <id>                        # Show index details with members
index idx join <id>                        # Join an index
index idx leave <id>                       # Leave an index
index idx invite <id> <email>              # Invite someone to an index
```

#### Opportunities

```
index opportunity list                     # List pending opportunities
index opportunity show <id>                # Show opportunity details with reasoning
index opportunity accept <id>              # Accept an opportunity
index opportunity reject <id>              # Reject an opportunity
index opportunity discover [query]         # Trigger discovery (via chat graph)
```

#### Profile

```
index profile show                         # Show own profile
index profile show <user-id>               # Show another user's profile
index profile update                       # Trigger profile regeneration
```

### Design principles

1. **Nouns first, then verbs.** `index conversation list`, not `index list conversations`. This keeps the help output organized by domain.
2. **Derived types, not explicit types.** The CLI does not ask users to specify H2A/H2H/A2A. Starting a conversation with "agent" is H2A; with "@username" is H2H. The type is a filter for listing, not a creation parameter.
3. **Streaming by default for H2A.** `index chat` opens an interactive streaming session. Non-interactive usage (piping, scripting) sends a single message and exits after the response.
4. **Consistent CRUD verbs.** `list`, `show`, `create`, `delete`, `update` across all resources. Domain-specific verbs (`accept`, `reject`, `discover`, `archive`) are added where they map to real user actions.
5. **Progressive disclosure.** The `chat` shorthand covers 80% of usage. Power users access the full `conversation` command tree for advanced operations.

---

## 5. Implementation Notes

### Interaction type derivation

The interaction type is computed from participants, not stored:

```typescript
function deriveInteractionType(participants: ConversationParticipant[]): 'h2a' | 'h2h' | 'a2a' {
  const users = participants.filter(p => p.participantType === 'user');
  const agents = participants.filter(p => p.participantType === 'agent');

  if (agents.length >= 2) return 'a2a';
  if (agents.length === 1 && users.length >= 1) return 'h2a';
  return 'h2h';
}
```

### CLI authentication

The CLI authenticates via the same Better Auth session system as the frontend. On first use, `index login` opens a browser-based OAuth flow and stores the session token locally. Subsequent commands use the stored token.

### CLI transport

- **H2A conversations:** The CLI opens an SSE connection to `/api/chat/stream` (or the unified equivalent) and renders streamed tokens to the terminal.
- **H2H conversations:** The CLI uses the conversation REST API for sending and the SSE stream endpoint (`/api/conversations/stream`) for receiving.
- **A2A observation:** The CLI polls or streams conversation messages for the specified A2A conversation ID.

---

## 6. Open Questions

1. **Agent identity in H2A conversations.** Currently the system-agent is implicit in chat sessions. In the unified model, should the agent be an explicit participant row? This would make `deriveInteractionType` work uniformly but requires creating an agent identity in the users/participants system.

2. **Session-scoped index.** H2A sessions can be scoped to an index (`indexId`). In the unified model, this becomes conversation metadata. Should H2H conversations also support index scoping (to keep messages within a community context)?

3. **Chat graph within multi-participant conversations.** For H2A+H2H hybrid, how does the chat graph handle context from multiple human participants? The current graph loads context for a single user. Multi-user context requires changes to the chat state and context loading.

4. **CLI interactive mode.** Should `index chat` support a REPL-like mode where the user types multiple messages in sequence, or should each invocation be a single message-response pair?
