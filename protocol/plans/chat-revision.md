# Chat Revision Plan

> **Status**: DRAFT  
> **Branch**: `chat-revision`  
> **Scope**: This plan covers Phase 1 through Phase 4 (scrape_url objective, index-scoped intent flow, optional index-scoped chat, uniform CRUD tools and confirmation).

## Overview

This document outlines **chat-revision** in four phases:

- **Phase 1**: Make the `scrape_url` tool objective-aware so that downstream tools (notably `create_intent`) receive cleaner, context-appropriate input.
- **Phase 2**: Centralize context and scope in the chat layer so that intent create/update and reconciliation respect **index scope**; the intent graph receives index when invoked from chat and compares against index-scoped intents.
- **Phase 3**: Allow **initializing the chat with an optional index**; pass that index through state and agent context so index-aware tools use it as the default when the agent omits it; conditional tool visibility and renames (e.g. get_intents).
- **Phase 4**: **Uniform CRUD tools** for intents, profile, indexes, and opportunities—with query-based read/update/delete where specified, IntentGraph signalling update-vs-create to ChatGraph, ProfileGraph/IndexGraph asking for clarification, personal indexes, and **confirmation for all update/delete actions** initiated by the chat graph or by direct subgraph use.

Later phases may remove scraping from `create_intent`, add an objective enum, or refine profile flows.

### Goals for Phase 1

1. **Smarter `scrape_url`** — Accept an optional natural-language **objective** (e.g. "user wants to create an intent", "user wants to update their profile") so scraping can tailor extraction or formatting for that use case.
2. **Cleaner inputs to `create_intent`** — When the agent scrapes with an intent-related objective, the returned content should be better suited for intent inference (e.g. project/goals-focused summary or structured excerpt), so `create_intent` receives higher-quality input instead of raw page dump.
3. **Single place for URL handling** — Prepare for scraping to be the **agent’s responsibility only**; `create_intent` will eventually stop scraping internally and rely on the agent calling `scrape_url` (with objective) then passing the result.

### Non-Goals (This Phase)

- Removing scraping from `create_intent` (follow-up phase).
- Changing the intent graph or ExplicitIntentInferrer contract.
- New UI or API surface beyond tool schema changes.

---

## Current State

### `scrape_url` (chat tools)

- **Location**: `src/lib/protocol/graphs/chat/chat.tools.ts`
- **Signature**: `scrape_url(url: string)` only.
- **Behavior**: Calls `scraper.extractUrlContent(url)`, truncates to 10k chars, returns `{ url, contentLength, content }`.
- **Consumer**: ChatAgent uses it for profile-from-URL and for “any URL in context”; the agent then passes raw `content` to `update_user_profile` or into the description for `create_intent`.

### `create_intent` (chat tools)

- **Current behavior**: Accepts `description: string`. If the string contains URLs, it **scrapes them internally**, builds `inputContent = description + "Context from <url>: ..." + scraped content`, and invokes the intent graph with that blob.
- **Intent graph**: Expects `inputContent` as a single string (raw text). ExplicitIntentInferrer extracts intents from that string; it has no notion of “objective” or “intent vs profile.”

### Scraper interface

- **Location**: `src/lib/protocol/interfaces/scraper.interface.ts`
- **Methods**: `scrape(url)`, `extractUrlContent(url)` — no objective or options parameter.
- **Adapter**: `src/adapters/scraper.adapter.ts` (e.g. Parallels/crawl-based); would need to support optional objective for Phase 1.

---

## Design: Objective-Aware `scrape_url`

### 1. Natural-language objective

- Add an optional parameter to the **tool** (and eventually to the **Scraper** interface): e.g. `objective?: string` — short natural language describing why we’re scraping.
- **Examples** the agent could pass:
  - `"User wants to create an intent from this link (e.g. project/repo)."`
  - `"User wants to update their profile from this link (e.g. LinkedIn/GitHub)."`
  - Omitted or `"general"` → current behavior (raw extraction).

### 2. Tool contract

- **Name**: `scrape_url` (unchanged).
- **Parameters**:
  - `url: string` (required).
  - `objective?: string` (optional). Examples: `"create an intent from this project/repo"`, `"update my profile from this page"`, or leave empty for generic scrape.
- **Return**: Keep existing shape for compatibility: `{ url, contentLength, content }`. The **content** may be:
  - **Generic (no objective)**: Same as today — raw extracted text, truncated.
  - **Intent objective**: Content tailored for intent inference (e.g. emphasize project description, goals, “looking for”, tech stack; optionally a short summary line + excerpt).
  - **Profile objective**: Content tailored for profile (e.g. person name, bio, skills, experience). (Can be implemented in same or a later phase.)

So `create_intent` continues to receive a single string; that string is just **better** when the agent called `scrape_url` with an intent-related objective.

### 3. Scraper interface extension

- **Option A (minimal)**: Add an optional second argument only where needed:
  - `extractUrlContent(url: string, options?: { objective?: string }): Promise<string | null>`.
- **Option B**: More structured objective type for clarity and validation:
  - `objective?: 'intent' | 'profile' | 'general'` plus optional `hint?: string` (natural language).
- **Recommendation**: Start with **optional natural-language `objective` string** in the tool and in the interface. Adapter can map known phrases to internal strategies (intent vs profile) or pass the string to an LLM/summarizer for tailoring. We can introduce an enum later if we want stronger typing.

### 4. Adapter behavior (scraper implementation)

- **Default (no objective)**: Unchanged — current `extractUrlContent(url)` behavior.
- **With objective**:
  - **Intent**: Prefer/summarize content that describes the project, goals, collaboration, or “looking for” signals. Options: (a) heuristic selection of sections, (b) LLM-based summarization with prompt “Summarize for intent extraction: …”, (c) hybrid. Goal: shorter, intent-relevant text so the intent inferrer gets less noise.
  - **Profile**: Prefer/summarize person-related content (name, bio, skills, experience). Can be implemented in Phase 1 or immediately after.

Implementations in `src/adapters/scraper.adapter.ts` (and any underlying lib like Parallels) need to accept and use the optional `objective`.

### 5. ChatAgent prompt

- Update the system prompt so the agent is encouraged to pass an **objective** when it knows the downstream use:
  - When the user provides a URL and the agent will call `create_intent`, call `scrape_url(url, objective: "User wants to create an intent from this link (project/repo or similar).")` (or similar wording).
  - When the user provides a URL for profile, call `scrape_url(url, objective: "User wants to update their profile from this page.")`.
- Update the system prompt so the agent is encouraged to ask what the downstream use is before calling `scrape_url`.
- Document in the tool description that `objective` helps return content better suited for that use.

---

## Implementation Order (Phase 1)

### Step 1: Interface and adapter

- [ ] **1.1** Extend `Scraper` in `src/lib/protocol/interfaces/scraper.interface.ts`:
  - Add optional `objective?: string` (or options bag) to `extractUrlContent`.
- [ ] **1.2** Update `src/adapters/scraper.adapter.ts`:
  - Pass through optional objective to underlying extraction/crawl.
  - Implement intent-oriented behavior (e.g. summarization or section selection for project/goals); keep default behavior when objective is absent.

### Step 2: Chat tool and agent

- [ ] **2.1** In `chat.tools.ts`, update `scrape_url`:
  - Add optional parameter `objective?: string` to the tool schema and implementation.
  - Call `scraper.extractUrlContent(url, { objective })` when provided.
- [ ] **2.2** In `chat.agent.ts`, update system prompt and tool description:
  - Describe when and how to use `objective` (intent vs profile).
  - Encourage the agent to pass the appropriate objective when the user’s goal is clear.

### Step 3: Tests and docs

- [ ] **3.1** Unit or integration tests for scraper adapter with `objective` (e.g. intent vs no objective).
- [ ] **3.2** Chat tool tests: `scrape_url` with and without `objective`.
- [ ] **3.3** Update `protocol/src/lib/protocol/graphs/chat/README.md` (or relevant docs) to document the new `scrape_url` contract and the chat-revision direction.

---

## Success Criteria (Phase 1)

- `scrape_url` accepts an optional natural-language `objective`.
- Scraper interface and at least one adapter support objective; intent-oriented objective produces content that is more intent-focused than raw scrape.
- ChatAgent prompt instructs the agent to use the objective when scraping for intent or profile.
- `create_intent` continues to work unchanged; when the agent uses `scrape_url(..., objective: "intent")` and passes the result into `create_intent`, the intent graph receives cleaner input (validated by manual or automated check).

---

## Phase 2: Index-Scoped Intent Flow (Centralize in Chat Layer)

### Problem

When the user creates or updates an intent from chat, the **intent graph** currently:

- Receives only `userId`, `userProfile`, `inputContent`, `operationMode`. No **index** is passed.
- In **prep**, loads **all** active intents for the user via `getActiveIntents(userId)` (global, no index filter).
- The **reconciler** then compares inferred intents to that global list, so "same intent?" is decided without index context. That leads to incorrect update vs create (e.g. merging intents that are the same wording but meant for different indexes, or failing to match when the user meant "update the one in this index").

The chat agent can **read** intents by index (`get_intents_in_index`, `list_index_intents`) but cannot **create/update in scope** of an index; `create_intent` has no index parameter and the intent graph has no index in its state.

### Goals for Phase 2

1. **Centralize context and scope in the chat layer** — The chat agent owns "which index (if any) the user is acting in" and uses existing tools (`get_intents_in_index`, `get_active_intents`) to see current intents in scope before choosing create vs update.
2. **Pass index into create_intent when relevant** — The chat tool `create_intent` accepts an optional **index** (e.g. `indexNameOrId?: string`). When the user is clearly in an index, the agent calls `create_intent(description, indexNameOrId)`.
3. **Intent graph receives scope** — The intent graph accepts optional **index** (e.g. in state or invoke input). When index is provided, **prep** loads active intents **in that index** (e.g. `getIntentsInIndexForMember(userId, indexId)`) instead of `getActiveIntents(userId)`. Reconciliation then compares inferred intents to **index-scoped** intents, so update vs create is correct per index.
4. **Single place for reconciliation logic** — Keep inference + reconciliation + execution in the intent graph; feed it the right scope from the chat layer so we don’t duplicate "same intent?" logic.

### Non-Goals (Phase 2)

- Changing reconciliation semantics (still create/update/expire); only the **set of active intents** passed to the reconciler becomes index-scoped when index is provided.
- Removing auto-indexing of newly created intents (chat tool can still add new intents to user’s indexes as today; index param is for **scope of comparison**, not only for assignment).
- Other callers of the intent graph (e.g. discovery form, batch) are not required to pass index; index is optional and backward compatible.

### Design: Index in the Chat → Intent Graph Path

#### 1. Chat agent (orchestration)

- **Prompt**: Instruct the agent to infer **index context** when the user refers to a community (e.g. "in YC Founders", "my intents in Open Mock Network"). When creating/updating intents, the agent should:
  - If the user is clearly in an index: call `get_intents_in_index(indexNameOrId)` first to see intents in that index, then call `create_intent(description, indexNameOrId)` so the backend can scope reconciliation to that index.
  - Optionally use `get_active_intents` when no index is implied (global scope).
- No change to **who** decides create vs update: the **reconciler** still decides. The agent’s job is to pass the right **scope** (index when relevant) so the reconciler sees the right active-intent list.

#### 2. Chat tool `create_intent`

- **Signature**: Add optional `indexNameOrId?: string`.
- **Behavior**: When invoking the intent graph, pass the optional index through (e.g. in the invoke payload). When absent, preserve current behavior (global active intents in prep).
- **Auto-indexing**: Keep existing behavior: after create, add new intent(s) to user’s indexes as today. The index parameter is used for **reconciliation scope**, not only for "add to this index."

#### 3. Intent graph (state and prep)

- **State**: Add optional `indexId?: string` or `indexNameOrId?: string` to `IntentGraphState` (or equivalent in invoke input). Optional; default undefined = global.
- **Prep node**: When `indexId` / `indexNameOrId` is set, load active intents **in that index** (e.g. use database method that returns intents for the user in that index, such as `getIntentsInIndexForMember(userId, indexNameOrId)`). When not set, keep `getActiveIntents(userId)`.
- **Interface**: `IntentGraphDatabase` (or the composite used by the chat tool) must expose a way to get "active intents for user in this index"; `getIntentsInIndexForMember` already exists for the chat tools and can be reused or mirrored for the graph’s database abstraction.
- **Reconciler**: No schema change; it still receives `activeIntents` (formatted string). The only change is that `activeIntents` is now index-scoped when index was provided.

#### 4. Backward compatibility

- Callers that don’t pass index (e.g. discovery form, batch pipelines) continue to get global reconciliation. Chat is the primary consumer that passes index when the user context is index-specific.

### Implementation Order (Phase 2)

#### Step 1: Intent graph state and prep

- [ ] **2.1** Add optional `indexNameOrId?: string` (or `indexId`) to intent graph input/state in `intent.graph.state.ts`.
- [ ] **2.2** In `intent.graph.ts`, prep node: when `state.indexNameOrId` (or indexId) is set, call a database method to load active intents **in that index** for the user (e.g. `getIntentsInIndexForMember(userId, indexNameOrId)`). When not set, keep `getActiveIntents(userId)`. Ensure `IntentGraphDatabase` (or the adapter used by the graph) exposes the index-scoped getter if not already available.

#### Step 2: Chat tool and agent

- [ ] **2.3** In `chat.tools.ts`, update `create_intent`: add optional parameter `indexNameOrId?: string` to the tool schema and implementation. When provided, pass it in the payload to `intentGraph.invoke(...)`.
- [ ] **2.4** In `chat.agent.ts`, update system prompt and tool description: when the user refers to an index (e.g. "add my intent in X", "my intents in Y"), the agent should call `get_intents_in_index` when useful and pass that index to `create_intent(description, indexNameOrId)` so reconciliation is index-scoped.

#### Step 3: Tests and docs

- [ ] **2.5** Intent graph: test invoke with `indexNameOrId` set and verify prep loads index-scoped intents; test without index and verify global behavior unchanged.
- [ ] **2.6** Chat tool: test `create_intent(description, indexNameOrId)` and verify intent graph receives index and reconciliation uses index-scoped list.
- [ ] **2.7** Update `protocol/plans/chat-revision.md` and `protocol/src/lib/protocol/graphs/chat/README.md` (and intent graph README if present) to document index-scoped create flow and centralization of context in the chat layer.

### Success Criteria (Phase 2)

- Chat agent prompt instructs passing index to `create_intent` when the user is acting in a specific index.
- `create_intent` accepts optional `indexNameOrId` and passes it to the intent graph.
- Intent graph prep loads **index-scoped** active intents when index is provided; reconciler output (create/update/expire) is based on that scope. When index is not provided, behavior remains global (backward compatible).
- No duplicate reconciliation logic; single place (intent graph reconciler) with correct scope from the chat layer.

### Files to Touch (Phase 2)

| File | Change |
|------|--------|
| `src/lib/protocol/graphs/intent/intent.graph.state.ts` | Add optional `indexNameOrId` (or `indexId`) to state/input. |
| `src/lib/protocol/graphs/intent/intent.graph.ts` | Prep node: when index set, load intents via index-scoped getter; else `getActiveIntents(userId)`. |
| `src/lib/protocol/interfaces/database.interface.ts` (or intent graph DB interface) | Ensure index-scoped getter for active intents is available to the graph (e.g. `getIntentsInIndexForMember` or equivalent). |
| `src/lib/protocol/graphs/chat/chat.tools.ts` | Add optional `indexNameOrId` to `create_intent`; pass to intent graph invoke. |
| `src/lib/protocol/graphs/chat/chat.agent.ts` | Prompt and tool description for index context and when to pass index to `create_intent`. |
| `src/lib/protocol/graphs/chat/README.md` | Document index-scoped create flow. |
| Intent graph README / docs | Document optional index input and prep behavior. |
| Tests (intent graph + chat tools) | Index-scoped prep; create_intent with/without index. |

---

## Phase 3: Optional Index-Scoped Chat (Initialize Chat with Index)

### Goal

Allow callers to **initialize a chat run with an optional index** (e.g. when the user opens chat from an index/community page). That index is passed through graph state and into the agent’s tool context. Index-aware tools use it as the **default** when the agent omits an index; **update_intent** and **delete_intent** are scoped like **create_intent**; **get_active_intents** becomes **get_intents** with optional index; **find_opportunities** and **list_my_opportunities** get optional index; **get_index_memberships** is hidden when index is set; **update_index_settings** defaults to the chat index. Everything remains optional; no index means current behavior.

### Design

#### 1. Chat graph state

- Add optional **`indexId?: string`** (or **`indexNameOrId?: string`** if names are accepted) to `ChatGraphState`. Default `undefined` = no default index.

#### 2. Streaming input

- **`streamChatEventsWithContext(input, checkpointer)`**: Extend `input` with optional **`indexId?: string`** (or `indexNameOrId`).
- **`streamChatEvents(input, sessionId, checkpointer)`**: Extend `input` with optional **`indexId?: string`**.
- When invoking the graph, include that value in the initial state (e.g. `{ userId, messages, indexId }`) so it is available as `state.indexId` for the run.

#### 3. Agent and tool context

- **Agent loop node**: When constructing `ChatAgent`, pass the index from state into the agent context, e.g. `new ChatAgent({ userId, database, embedder, scraper, indexId: state.indexId })`.
- **ToolContext type**: Add optional **`indexId?: string`** (or `indexNameOrId`) so tools receive a default index for this chat run when the chat was initialized with one.

#### 4. Tool behavior when chat graph index is set

**Tools that get optional index and default from context**

- **`create_intent`** (Phase 2): If the agent omits `indexNameOrId` and `context.indexId` is set, use `context.indexId`. Otherwise use the value passed by the agent (or global).
- **`get_intents_in_index`**, **`list_index_intents`**, **`list_index_members`**, **`create_opportunity_between_members`**: Optional index parameter; when missing and `context.indexId` is set, use `context.indexId`.
- **`find_opportunities`**: Add optional **`indexNameOrId?: string`**. When provided (or defaulted from `context.indexId`), pass that index as `indexScope` (e.g. `[indexId]`) instead of all memberships. So “find opportunities” in index-scoped chat means “in this index only.”
- **`list_my_opportunities`**: Add optional **`indexNameOrId?: string`**. When provided (or defaulted from `context.indexId`), return only opportunities in that index (backend must support filtering by index).

**Intent tools scoped like create_intent**

- **`update_intent`** and **`delete_intent`**: When chat graph index is set, scope the operation the same way as **`create_intent`**—e.g. intent graph receives optional index for update/delete; prep loads active intents in that index so “update/delete that intent” is resolved only against intents in the current index. Ensures the agent cannot update or delete an intent that belongs to another index when the user is in index-scoped chat.

**get_active_intents → get_intents with optional index**

- **Rename** **`get_active_intents`** to **`get_intents`**.
- Add optional **`indexNameOrId?: string`**. When omitted: current behavior (all active intents). When provided (or defaulted from `context.indexId`): return only the user’s intents in that index (same semantics as current `get_intents_in_index`). Single tool for “all my intents” or “my intents in this index.”

**get_index_memberships when index is set**

- When the chat is initialized with an index (`context.indexId` set), **do not expose** **`get_index_memberships`** to the agent for that run (omit it from the tools list, or equivalent). Scope is fixed to the single index; the agent should not list all memberships.

**update_index_settings and chat graph index**

- **`update_index_settings`**: When chat has a default index, **automatically default** the index parameter from `context.indexId` when the agent omits it (so “update settings” in index-scoped chat means “update this index’s settings”). If no chat index is set, the LLM must provide the index explicitly (current behavior).

#### 5. API / controller

- The HTTP endpoint that starts the stream (e.g. `POST /chat/stream`) should accept an optional **`indexId`** (or `indexNameOrId`) in the request body (or query), e.g. `{ message, sessionId?, indexId? }`. When the frontend opens chat from an index page, it sends that index; the backend passes it into `streamChatEventsWithContext({ userId, message, sessionId, indexId })`.

#### 6. Session-level index (optional, later)

- Optionally persist **`indexId`** on the chat session (e.g. when creating or joining a session). When loading context for a run, if the request does not override it, use the session’s `indexId` as the default. This gives “this whole conversation is in index X” semantics. Can be added after request-level index works.

### Implementation Order (Phase 3)

#### Step 1: State and streaming

- [ ] **3.1** Add optional `indexId?: string` (or `indexNameOrId`) to `ChatGraphState` in `chat.graph.state.ts`.
- [ ] **3.2** In `chat.streaming.ts`, extend `streamChatEventsWithContext` and `streamChatEvents` input with optional `indexId?`; pass it into the graph invoke state when provided.

#### Step 2: Agent and tool context

- [ ] **3.3** In `chat.graph.ts` agent loop node, pass `state.indexId` into `ChatAgent` constructor.
- [ ] **3.4** Extend **ToolContext** type (e.g. in `chat.tools.ts`) with optional `indexId?: string`.
- [ ] **3.5** When building the tools list: if `context.indexId` is set, **omit** `get_index_memberships` from the list so the agent cannot list all memberships in index-scoped chat.

#### Step 3: Tool behavior (default index and optional index)

- [ ] **3.6** **create_intent**, **get_intents_in_index**, **list_index_intents**, **list_index_members**, **create_opportunity_between_members**: when the tool’s index argument is omitted and `context.indexId` is set, use `context.indexId` as default.
- [ ] **3.7** **find_opportunities**: Add optional `indexNameOrId?`; when provided or defaulted from `context.indexId`, use that index as `indexScope` (single-index scope) instead of all memberships.
- [ ] **3.8** **list_my_opportunities**: Add optional `indexNameOrId?`; when provided or defaulted from `context.indexId`, filter results to opportunities in that index (backend support as needed).
- [ ] **3.9** **update_intent** and **delete_intent**: Pass optional index into intent graph when `context.indexId` is set (or when agent passes index), so update/delete is scoped to intents in that index (intent graph prep loads index-scoped intents for update/delete flows as in Phase 2).
- [ ] **3.10** **get_active_intents** → **get_intents**: Rename tool; add optional `indexNameOrId?`. When omitted return all active intents; when set (or defaulted from context) return user’s intents in that index only. Update agent prompt and any references.
- [ ] **3.11** **update_index_settings**: When `context.indexId` is set, use it as default for the index parameter when the agent omits it; otherwise LLM must pass index (current behavior).

#### Step 4: API and docs

- [ ] **3.12** In the chat controller (or route) that handles the stream endpoint, accept optional `indexId` in the request and pass it to `streamChatEventsWithContext` (or equivalent).
- [ ] **3.13** Update `protocol/plans/chat-revision.md` and `protocol/src/lib/protocol/graphs/chat/README.md` to document optional index-scoped chat, default index behavior, tool renames, and conditional tool visibility.

### Success Criteria (Phase 3)

- Callers can pass optional `indexId` (or `indexNameOrId`) when starting a chat stream; when provided, it is stored in state and passed to the agent’s tool context.
- Index-aware tools use `context.indexId` as default when their index argument is omitted (`create_intent`, `get_intents_in_index`, `list_index_intents`, `list_index_members`, `create_opportunity_between_members`, `find_opportunities`, `list_my_opportunities`, `update_index_settings`).
- **get_intents** (renamed from `get_active_intents`) accepts optional index and defaults from context when in index-scoped chat.
- **update_intent** and **delete_intent** are index-scoped when chat graph index is set (intent graph receives index for update/delete).
- **get_index_memberships** is not available when chat graph index is set.
- **update_index_settings** automatically receives chat graph index when in index-scoped chat when the agent omits it.
- When no index is passed, behavior is unchanged (backward compatible).

### Files to Touch (Phase 3)

| File | Change |
|------|--------|
| `src/lib/protocol/graphs/chat/chat.graph.state.ts` | Add optional `indexId` (or `indexNameOrId`) to state. |
| `src/lib/protocol/graphs/chat/streaming/chat.streaming.ts` | Add optional `indexId?` to stream input; pass into graph state. |
| `src/lib/protocol/graphs/chat/chat.graph.ts` | Pass `state.indexId` into `ChatAgent` constructor. |
| `src/lib/protocol/graphs/chat/chat.tools.ts` | Add `indexId?` to ToolContext; default index in index-aware tools; rename get_active_intents → get_intents with optional index; add optional index to find_opportunities and list_my_opportunities; scope update_intent/delete_intent; omit get_index_memberships when context.indexId set; update_index_settings default from context. |
| `src/lib/protocol/graphs/chat/chat.agent.ts` | Update prompt for get_intents (rename), conditional tool list when index set, and update_index_settings behavior. |
| Intent graph (Phase 2) | Support optional index for update/delete flows (prep loads index-scoped intents when index provided). |
| Chat controller / route for stream endpoint | Accept optional `indexId` in request; pass to streaming call. |
| `src/lib/protocol/graphs/chat/README.md` | Document index-scoped chat, tool renames, default index, and conditional tool visibility. |
| Tests | Stream with/without indexId; tools using context.indexId; get_index_memberships omitted when index set; get_intents with/without index; find_opportunities/list_my_opportunities with index; update_index_settings default. |

---

## Phase 4: Uniform CRUD Tools and Confirmation

### Goal

Define chat graph tools as **uniform CRUD operations** for intents, profile, indexes, and opportunities—with query-based read/update/delete where appropriate, subgraphs signalling clarification or update-vs-create back to the ChatGraph, personal and public/private indexes, and **confirmation required for all update and delete actions** when initiated by the chat graph or by direct subgraph use.

### General Note: Confirmation for Destructive Actions

- **Every update and delete action** initiated by the chat graph must ask for user confirmation before performing the change (they are destructive).
- **Direct use of subgraphs** (e.g. when a tool invokes the intent graph or index graph) should also require confirmation when the subgraph would perform an update or delete—either the tool returns a “pending confirmation” result and the agent asks the user, or the subgraph returns a confirmation-required state and the chat layer surfaces it. Design to be agreed (e.g. tool returns `needsConfirmation: true` and payload; user confirms in next message; tool is called again with `confirmed: true`).

---

### 1. Intents

- **`create_intent`**: Keep as is (concept-based description, optional index from Phase 2/3, intent graph create flow).
- **`read_intents`**: Replace/rename from `read_intents` (Phase 3) or `get_intents_in_index` / `get_active_intents`. Accept a **query** (e.g. natural-language filter or optional index scope). Returns intents matching the query/scope.
- **`update_intent`**: **With query**, and **separate from create**. The **IntentGraph must not perform update by itself** when it could infer “same intent”; instead it should **signal to the ChatGraph** that the user likely wants to **update** an existing intent (e.g. return `suggestedAction: 'update'`, candidate intent id, and payload). The ChatGraph/agent then calls **`update_intent`** (with query or intent id and new description) as a distinct operation. So: IntentGraph does inference + reconciliation for *create* only, or returns “consider update” so the chat layer can call `update_intent`.
- **`delete_intent`**: **With query** (e.g. description or intent id). Deletes (archives) the matching intent. Requires confirmation before executing.

---

### 2. Profile

- Profiles are **not index-bound** for now. CRUD without index.
- **`read_profile`**: Read current user profile (already exists as get_user_profile; align name).
- **`update_profile`** / **`create_profile`**: Create or update profile. **ProfileGraph** must **ask for clarification** when creating profiles if **user name** and **social URLs** are unknown (e.g. return `needsClarification: true`, `missingFields: ['full_name', 'social_urls']`). ChatGraph/agent should be smart enough to ask the user for these and call again with the provided info.
- **`delete_profile`**: If supported, same confirmation rule as other deletes.

---

### 3. Indexes

**Personal index**

- Every user gets their **own private index** with full control. This may already exist or be created on first use; Phase 4 should state it explicitly and ensure tools respect it.

**Public / private indexes**

- **`create_index`**: Users can create a **personal index** or **separate indexes** and define them as public/private, etc. If **IndexGraph** does not have enough information for all required fields, it should **ask for clarification** (e.g. return `needsClarification: true`, `missingFields: ['title', 'joinPolicy']`). **ChatGraph** should ask the user for these and pass them back (same pattern as ProfileGraph).
- **`read_indexes`**: Accept **filters** (e.g. optional index id/name, “mine”, “member of”). When there is an **active index in the ChatGraph** (Phase 3), **return only that index** with a **message** stating that results are scoped to the current index because the user is acting in that context.
- **`update_index`**: Similar to create_index in terms of fields (title, prompt, join policy, etc.) but **checks `owner`** against the current user id. Owner-only. Requires confirmation.
- **`delete_index`**: **Very destructive**. If there are **other members** besides the index owner, **disallow** deletion (return error). Otherwise require explicit confirmation before deleting.

---

### 4. Opportunities

- **`create_opportunity`**: **Highly complex**. Can be initiated by a **source user**, a **third-party user** (e.g. “I think A and B should meet”), or by the **system** automatically. Inspect existing opportunity implementation (e.g. `create_opportunity_between_members`, opportunity graph, detection source) for patterns. Design a unified or layered create that supports these initiator types and returns clarification/confirmation when needed.
- **`read_opportunity`**: **Users** can read their **own** opportunities. **Index owners** can read **all opportunities** in indexes they own. Support optional filters (index, status, etc.).
- **`update_opportunity`**: Similar complexity to create (e.g. status, interpretation). **Only the initiator** can update. Requires confirmation.
- **`delete_opportunity`**: **Always soft delete** by **updating the status field** (e.g. expired, rejected). Can be triggered by: user **rejecting**, **expiring**, or **system** (e.g. cron). Chat-initiated delete must require confirmation.

---

### Implementation Order (Phase 4)

#### Step 1: Confirmation and clarification contract

- [ ] **4.1** Define a **confirmation** contract: when a tool would perform an update or delete, it can return `needsConfirmation: true`, `action`, `payload`, and a short summary so the agent can ask the user and, on confirmation, call again with `confirmed: true` or a confirmation token.
- [ ] **4.2** Define a **clarification** contract: subgraphs (Intent, Profile, Index) can return `needsClarification: true`, `missingFields: string[]`, optional `message`. ChatGraph/agent asks the user and retries with the provided data.

#### Step 2: Intents

- [ ] **4.3** **read_intents**: Implement or align with Phase 3 `read_intents`; ensure it accepts a **query** (and optional index). Document behavior.
- [ ] **4.4** **IntentGraph**: Change behavior so it **does not** perform update by itself. When reconciliation would “update” an existing intent, return a signal (e.g. `suggestedAction: 'update'`, `candidateIntentId`, `suggestedPayload`) so **ChatGraph** can call **update_intent** explicitly.
- [ ] **4.5** **update_intent**: Accept **query** (or intent id) and new description; call intent graph in “update” mode with that scope. Require confirmation before executing.
- [ ] **4.6** **delete_intent**: Accept **query** (or intent id). Require confirmation; then archive intent.

#### Step 3: Profile

- [ ] **4.7** Align profile tool names to **read_profile**, **update_profile** (create = update when no profile). Ensure **ProfileGraph** returns **clarification** when name/social URLs unknown on create; ChatGraph prompt instructs agent to ask user and retry.
- [ ] **4.8** Add **delete_profile** if required; same confirmation rule.

#### Step 4: Indexes

- [ ] **4.9** **create_index**: Implement or extend; support personal index and public/private indexes. **IndexGraph** returns clarification when fields missing; ChatGraph asks user.
- [ ] **4.10** **read_indexes**: Implement with **filters**. When ChatGraph has active index (Phase 3), return only that index with message that results are scoped.
- [ ] **4.11** **update_index**: Owner check; same clarification pattern if needed. Require confirmation.
- [ ] **4.12** **delete_index**: Check for other members; disallow if any. Otherwise require confirmation; then delete.

#### Step 5: Opportunities

- [ ] **4.13** Inspect **opportunity implementation** (create_opportunity_between_members, opportunity graph, detection sources). Design **create_opportunity** that supports source user, third-party, and system-initiated creation; document and implement.
- [ ] **4.14** **read_opportunity**: User reads own; index owner reads all in owned indexes. Add filters (index, status) as needed.
- [ ] **4.15** **update_opportunity**: Initiator-only; require confirmation.
- [ ] **4.16** **delete_opportunity**: Soft delete via status update (expire/reject/system). Chat-initiated requires confirmation.

#### Step 6: ChatGraph and prompts

- [ ] **4.17** Update **ChatAgent** prompt and tool descriptions for all new/renamed tools, confirmation flow (ask user before confirming), and clarification flow (ask user for missing fields).
- [ ] **4.18** Ensure **direct subgraph use** (when a tool invokes a graph that would update/delete) goes through the same confirmation path (tool returns needsConfirmation or subgraph returns it and tool surfaces to agent).

### Success Criteria (Phase 4)

- Intents: create_intent unchanged; read_intents with query; update_intent and delete_intent with query, **IntentGraph signals update to ChatGraph** instead of updating itself; confirmation for update/delete.
- Profile: CRUD without index; ProfileGraph asks for clarification when name/social URLs unknown; ChatGraph asks user and retries.
- Indexes: create_index (personal + public/private), read_indexes (filters + scoped message when active index), update_index (owner check), delete_index (disallow if other members; confirm otherwise); clarification when fields missing.
- Opportunities: create_opportunity (source/third-party/system), read_opportunity (own + index owner all), update_opportunity (initiator), delete_opportunity (soft delete via status); confirmation for update/delete.
- All update and delete actions from chat (and from direct subgraph use) require confirmation before execution.

### Files to Touch (Phase 4)

| File / Area | Change |
|-------------|--------|
| Chat tools (chat.tools.ts) | Implement/rename: read_intents(query), update_intent(query/id, description), delete_intent(query); read_profile, update_profile, delete_profile?; create_index, read_indexes(filters), update_index, delete_index; create_opportunity, read_opportunity, update_opportunity, delete_opportunity. Confirmation and clarification handling in tool responses. |
| Intent graph | Return suggestedAction: 'update' + candidate id/payload instead of performing update; support update/delete by query or id. |
| Profile graph | Return needsClarification + missingFields when name/social URLs unknown on create. |
| Index graph / schema | create_index (personal + public/private), clarification when fields missing; delete_index checks other members. |
| Opportunity implementation | Unify/create_opportunity (source, third-party, system); read (own + index owner); update (initiator); delete (soft delete via status). |
| Chat agent (chat.agent.ts) | Prompt and tool descriptions for CRUD, confirmation flow, clarification flow. |
| Protocol/plans/chat-revision.md | This Phase 4 section. |
| Tests | Confirmation and clarification flows; CRUD tools per resource. |

---

## Later Phases (Out of Scope for This Plan)

- **Remove scraping from `create_intent`**: Agent always calls `scrape_url` first when the user message contains URLs; `create_intent` only receives the combined description (and optionally pre-scraped content). Depends on Phase 1 (objective-aware scrape).
- **Objective enum / structured hints**: If we want stricter typing or more strategies (e.g. “opportunity”, “research”), introduce an enum or a small set of known objectives in a later phase.
- **Profile-specific scraping**: If not fully done in Phase 1, implement profile-oriented extraction/summarization in the adapter using the same `objective` parameter.
- **Further chat centralization**: If we later want the agent to explicitly choose create vs update (e.g. by calling `get_intents_in_index` then `update_intent(id, ...)` vs `create_intent(...)`), that can build on Phase 2's index-scoped flow; reconciliation would remain in the intent graph with scope from the chat layer.

---

## Files to Touch (Phase 1)

| File | Change |
|------|--------|
| `src/lib/protocol/interfaces/scraper.interface.ts` | Add optional `objective` (or options) to `extractUrlContent`. |
| `src/adapters/scraper.adapter.ts` | Implement objective-aware extraction (intent; profile optional). |
| `src/lib/protocol/graphs/chat/chat.tools.ts` | Add `objective` to `scrape_url` tool; pass to scraper. |
| `src/lib/protocol/graphs/chat/chat.agent.ts` | Prompt and tool description for using `objective`. |
| `src/lib/protocol/graphs/chat/README.md` | Document new behavior and chat-revision direction. |
| Tests (adapter + chat tools) | New or updated tests for objective-aware scrape. |

---

## Summary

- **Phase 1** makes **`scrape_url` smarter** by adding an optional **natural-language objective**. The scraper (and adapter) return content tailored for that goal (e.g. intent vs profile), so **`create_intent` receives cleaner input**. This sets the foundation for moving all URL handling into the ChatAgent and removing internal scraping from `create_intent` in a later phase.

- **Phase 2** **centralizes context and scope in the chat layer**: the chat agent infers index when the user is acting in a community and passes optional **index** to **`create_intent`**. The intent graph accepts optional index and, when set, loads **index-scoped** active intents in prep so the reconciler’s create/update/expire decisions are correct per index. Reconciliation stays in one place (the intent graph); the chat layer supplies the right scope.

- **Phase 3** allows **initializing the chat with an optional index**: callers pass optional **`indexId`** in the stream request; it flows into state and tool context. Index-aware tools default to that index when the agent omits it. **find_opportunities** and **list_my_opportunities** get optional index; **update_intent** and **delete_intent** are index-scoped like create_intent. **get_active_intents** is renamed to **get_intents** and gets an optional index filter. When index is set, **get_index_memberships** is not exposed; **update_index_settings** defaults to the chat graph index. No index means current behavior (backward compatible).

- **Phase 4** defines **uniform CRUD tools** for intents, profile, indexes, and opportunities: **Intents** — create_intent (as is), read_intents with query, update_intent with query (IntentGraph signals update to ChatGraph instead of updating itself), delete_intent with query. **Profile** — CRUD without index; ProfileGraph asks for clarification when name/social URLs unknown. **Indexes** — personal index per user; create_index (personal + public/private, IndexGraph asks for clarification); read_indexes with filters (scoped message when active index); update_index (owner check); delete_index (disallow if other members). **Opportunities** — create_opportunity (source/third-party/system), read_opportunity (own + index owner all), update_opportunity (initiator), delete_opportunity (soft delete via status). **All update and delete actions** from the chat graph or direct subgraph use **require user confirmation** before execution.
