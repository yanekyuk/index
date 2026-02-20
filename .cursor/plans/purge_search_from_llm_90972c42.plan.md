---
name: Purge search from LLM
overview: Replace every LLM-visible occurrence of the word "search" in tool descriptions, tool response messages, and documentation content with vocabulary aligned to chat.prompt.ts conventions ("look into", "find", "discover", "looking up", etc.). Internal code variables like `searchQuery` are left unchanged to avoid a 12-file rename with no user-facing benefit.
todos:
  - id: fix-opportunity-tools
    content: Replace 5 'search' occurrences in opportunity.tools.ts (tool description, param describe, 3 response messages)
    status: pending
  - id: fix-utility-tools
    content: Replace 4 'search' occurrences in utility.tools.ts read_docs content strings
    status: pending
  - id: fix-profile-tools
    content: Replace 1 'search' occurrence in profile.tools.ts tool description
    status: pending
isProject: false
---

# Purge "search" from LLM-visible text

## Principle

`chat.prompt.ts` bans "search" and prescribes alternatives:

- For indexed data: **"looking up"**
- Elsewhere: **"look into"**, **"check"**, **"find matches"**, **"see who aligns"**, **"discover"**

The word "search" currently appears **17 times** in text the LLM can read (tool descriptions, tool responses, docs content). These contradict the ban and cause the agent to echo "search" back to users.

**Scope**: Only LLM-visible strings (tool descriptions, `.describe()` text, response messages, docs content). Internal variable names (`searchQuery`, `searchWithHydeEmbeddings`, etc.) are unchanged -- they are never shown to the user and renaming them touches 12+ files across frontend/backend/tests with no behavioral benefit.

---

## Changes by file

### 1. [opportunity.tools.ts](protocol/src/lib/protocol/tools/opportunity.tools.ts) -- 6 occurrences

**Tool description** (lines 106-111):

- `"Finds matching people via semantic search"` --> `"Finds matching people based on intent overlap"`

**Parameter `.describe()**` (line 116):

- `"Discovery mode: what to search for."` --> `"Discovery mode: what to look for."`

**Response messages**:

- Line 352: `"No matching opportunities for that search."` --> `"No matching opportunities found."`
- Line 446: `"Use create_opportunities to search for connections."` --> `"Use create_opportunities to find connections."`
- Line 541: same as 446 (duplicate) -- apply same fix

### 2. [utility.tools.ts](protocol/src/lib/protocol/tools/utility.tools.ts) -- 4 occurrences

These are inside `read_docs` content strings the LLM sees when it calls the docs tool.

- Line 55: `"Has a vector embedding for semantic search"` --> `"Has a vector embedding for semantic matching"`
- Line 80: `"Triggered by create_intent or create_opportunities with searchQuery"` --> `"Triggered by create_intent or create_opportunities with a discovery query"`
- Line 103: `"Discovery (semantic search for matching intents)"` --> `"Discovery (semantic matching of intents)"`
- Line 104: `"Semantic search uses HyDE embeddings"` --> `"Semantic matching uses HyDE embeddings"`

### 3. [profile.tools.ts](protocol/src/lib/protocol/tools/profile.tools.ts) -- 1 occurrence

**Tool description** (line 133):

- `"via web search"` --> `"via public web data"`

### 4. [chat.prompt.ts](protocol/src/lib/protocol/agents/chat.prompt.ts) -- 1 occurrence in tool table

**Tool table** (line 149):

- `searchQuery?` in the params column -- this mirrors the actual Zod param name, so it stays as-is for accuracy. No text change needed here since it's a parameter name, not prose.

### 5. [suggestion.generator.ts](protocol/src/lib/protocol/agents/suggestion.generator.ts) -- already correct

Line 33 already lists "search" in its **avoid** list. No change needed.

---

## What is NOT changed (and why)


| Item                                                     | Reason                                                                                                                                                                                                            |
| -------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `searchQuery` variable/param name                        | Used in 12 files (state, graph, queue, service, tests, frontend). Renaming is high-risk, low-reward -- the LLM sees it as a JSON key but the `.describe()` text (which we fix) has more influence on word choice. |
| `searchWithHydeEmbeddings`, `searchWithProfileEmbedding` | Internal adapter method names, never in LLM-visible strings.                                                                                                                                                      |
| `searchUser` (Parallels API)                             | External API call, not shown to the chat agent.                                                                                                                                                                   |
| `hyde.generator.ts` / `profile.hyde.generator.ts`        | These prompts are for internal agents (HyDE generator), not the chat agent. The chat agent never sees them.                                                                                                       |
| Lines 66, 69, 70, 319 in `chat.prompt.ts`                | These are the **ban itself** -- they correctly mention "search" to tell the agent not to use it.                                                                                                                  |


