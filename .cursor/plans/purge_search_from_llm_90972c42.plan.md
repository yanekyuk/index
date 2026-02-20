---
name: Purge search from LLM
overview: Replace every LLM-visible occurrence of the word "search" in tool descriptions, tool response messages, and documentation content with vocabulary aligned to chat.prompt.ts conventions ("look into", "find", "discover", "looking up", etc.). Internal code variables like `searchQuery` are left unchanged to avoid a 12-file rename with no user-facing benefit.
todos:
  - id: fix-opportunity-tools
    content: Replace 5 search occurrences in opportunity.tools.ts (tool description, param describe, 3 response messages)
    status: completed
  - id: fix-opportunity-discover
    content: Replace 2 search occurrences in opportunity.discover.ts (error messages)
    status: completed
  - id: fix-utility-tools
    content: Replace 3 search occurrences in utility.tools.ts read_docs content strings
    status: completed
  - id: fix-profile-tools
    content: Replace 1 search occurrence in profile.tools.ts tool description
    status: completed
isProject: false
---

# Purge "search" from LLM-visible text

## Principle

`chat.prompt.ts` bans "search" and prescribes alternatives:

- For indexed data: **"looking up"**
- Elsewhere: **"look into"**, **"check"**, **"find matches"**, **"see who aligns"**, **"discover"**

The word "search" currently appears **11 times** in text the LLM can read (tool descriptions, tool responses, docs content). These contradict the ban and cause the agent to echo "search" back to users.

**Scope**: Only LLM-visible strings (tool descriptions, `.describe()` text, response messages, docs content). Internal variable names (`searchQuery`, `searchWithHydeEmbeddings`, etc.) are unchanged -- they are never shown to the user and renaming them touches 12+ files across frontend/backend/tests with no behavioral benefit.

---

## Changes by file

### 1. [opportunity.tools.ts](protocol/src/lib/protocol/tools/opportunity.tools.ts) — 5 occurrences

**Tool description** (`create_opportunities`):

```diff
- "Finds matching people via semantic search"
+ "Finds matching people based on intent overlap"
```

**Parameter `.describe()`** (`searchQuery`):

```diff
- "Discovery mode: what to search for."
+ "Discovery mode: what to look for."
```

**Response messages** (3 occurrences):

```diff
- "No matching opportunities for that search. Call create_intent with the suggested description, then create_opportunities again."
+ "No matching opportunities found. Call create_intent with the suggested description, then create_opportunities again."
```

```diff
- "You have no opportunities yet. Use create_opportunities to search for connections."
+ "You have no opportunities yet. Use create_opportunities to find connections."
```

(The above message appears twice in the file — apply to both.)

### 2. [opportunity.discover.ts](protocol/src/lib/protocol/support/opportunity.discover.ts) — 2 occurrences

**Error/fallback messages**:

```diff
- "No matching opportunities found. Try a different search or create intents to improve matching."
+ "No matching opportunities found. Try a different query or create intents to improve matching."
```

```diff
- "Failed to search for opportunities. Please try again."
+ "Failed to find opportunities. Please try again."
```

### 3. [utility.tools.ts](protocol/src/lib/protocol/tools/utility.tools.ts) — 3 occurrences

These are inside `read_docs` content strings the LLM sees when it calls the docs tool.

```diff
- "Has a vector embedding for semantic search"
+ "Has a vector embedding for semantic matching"
```

```diff
- "Discovery (semantic search for matching intents)"
+ "Discovery (semantic matching of intents)"
```

```diff
- "Semantic search uses HyDE embeddings"
+ "Semantic matching uses HyDE embeddings"
```

### 4. [profile.tools.ts](protocol/src/lib/protocol/tools/profile.tools.ts) — 1 occurrence

**Tool description** (`create_user_profile`):

```diff
- "via web search"
+ "via web lookup"
```

### 5. No changes needed

The following files mention "search" but are correctly excluded:

- `**chat.prompt.ts**` — The `searchQuery?` in the tool table mirrors the actual Zod param name. The ban language itself correctly mentions "search" to tell the agent not to use it.
- `**suggestion.generator.ts**` — Lists "search" in its **avoid** list (correct usage).

---

## What is NOT changed (and why)


| Item                                                     | Reason                                                                                                                                                                                                           |
| -------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `searchQuery` variable/param name                        | Used in 12 files (state, graph, queue, service, tests, frontend). Renaming is high-risk, low-reward — the LLM sees it as a JSON key but the `.describe()` text (which we fix) has more influence on word choice. |
| `searchQuery` in `read_docs` content                     | The docs reference the actual parameter name; changing it would create a mismatch between docs and the real tool parameter.                                                                                      |
| `searchWithHydeEmbeddings`, `searchWithProfileEmbedding` | Internal adapter method names, never in LLM-visible strings.                                                                                                                                                     |
| `searchUser` (Parallels API)                             | External API call, not shown to the chat agent.                                                                                                                                                                  |
| `hyde.generator.ts` / `profile.hyde.generator.ts`        | These prompts are for internal agents (HyDE generator), not the chat agent. The chat agent never sees them.                                                                                                      |
| `chat.prompt.ts` ban language                            | Lines mentioning "search" are the **ban itself** — they correctly tell the agent not to use the word.                                                                                                            |
| `suggestion.generator.ts` avoid list                     | Lists "search" as a word to avoid (correct usage).                                                                                                                                                               |
| `README.md`                                              | Developer documentation, not served to the LLM via `read_docs`.                                                                                                                                                  |


