# Query discovery debug: 0 opportunities + slowness

**Date:** 2026-02-25  
**Context:** "Any visual artists?" returns 0 opportunities; Yuki Tanaka (visual artist persona) should be found. Discovery also takes very long.

## Data flow (systematic tracing)

1. **Chat tool** `create_opportunities({ searchQuery: "visual artists" })` → `runDiscoverFromQuery({ query, indexScope, ... })`.
2. **runDiscoverFromQuery** passes `searchQuery: "visual artists"` and `options.strategies = selectStrategiesFromQuery("visual artists")` → `["mirror", "reciprocal"]` into the opportunity graph.
3. **Opportunity graph**
   - **Prep:** Loads viewer profile (embedding may be null) and intents.
   - **Scope:** Resolves 4 indexes (e.g. Stack, Latent, Arena, Syllabus).
   - **Resolve:** No `triggerIntentId`, no intent matches "visual artists" → `discoverySource: 'profile'`.
   - **Discovery:** If `discoverySource === 'profile'` and viewer has **no profile vector** and **searchQuery** is set → we call `runQueryHydeDiscovery()`.
4. **runQueryHydeDiscovery**
   - Builds query HyDE: `hydeGenerator.invoke({ sourceType: 'query', sourceText: 'visual artists', strategies: ['mirror','reciprocal'] })` → returns embeddings per strategy (LLM + embed; can be slow).
   - **Mirror** → target corpus **profiles**: `embedder.searchWithHydeEmbeddings` → `searchProfilesForHyde` → queries `hyde_documents` where `sourceType = 'profile'`, `strategy = 'mirror'`, joined with `index_members` so only users in the 4 indexes. So **Yuki must have a row in `hyde_documents` (sourceType=profile, strategy=mirror)** and be in at least one of the 4 indexes.
   - **Reciprocal** → target corpus **intents**: search intent HyDE docs.
5. **Profile HyDE** is written by the profile graph in write mode (`embedSaveHydeNode` → `database.saveHydeDocument({ sourceType: 'profile', strategy: 'mirror', ... })`). Seed runs `embedTesterProfiles` (profile graph write for each persona) and enqueues `ensure_profile_hyde` jobs; workers process jobs. If seed ran fully, every persona (including Yuki) should have profile HyDE unless the graph failed for that user.

## Root cause hypotheses (before evidence)

| # | Hypothesis | How to confirm |
|---|------------|----------------|
| A | **runQueryHydeDiscovery is never called** (e.g. discoverySource !== 'profile', or searchQuery empty, or wrong code path). | Logs: `[Graph:Discovery] Starting semantic search` with `discoverySource` and `searchQueryPreview`; then `Profile source, no vector, has searchQuery → running query HyDE path`. |
| B | **HyDE generator returns empty** for query "visual artists" (LLM/cache failure). | Logs: `HyDE generator result` with `strategyCount`, `strategies`, `hasMirror`, `hasReciprocal`. If strategyCount 0 → generator problem. |
| C | **No profile HyDE in DB** for index members (Yuki). Seed’s `embedTesterProfiles` or workers didn’t persist profile HyDE. | Logs: `searchWithHydeEmbeddings raw results` with `fromProfile: 0`. Then check DB: `SELECT * FROM hyde_documents WHERE source_type = 'profile' AND strategy = 'mirror'` and index membership for Yuki. |
| D | **Profile HyDE exists but similarity &lt; minScore (0.5).** | Same logs; if fromProfile &gt; 0 we’re good; if 0, check scores in adapter or lower minScore temporarily. |

## Diagnostic logging added (worktree)

In `protocol/src/lib/protocol/graphs/opportunity.graph.ts`:

- **Discovery start:** `searchQueryPreview` in `[Graph:Discovery] Starting semantic search`.
- **Profile path:** Existing log `Profile source, no vector, has searchQuery → running query HyDE path` and `Query HyDE path complete` with `candidatesFound`.
- **runQueryHydeDiscovery:** `runQueryHydeDiscovery start` (searchText, strategies); `HyDE generator result` (strategyCount, strategies, hasMirror, hasReciprocal); `searchWithHydeEmbeddings raw results` (total, fromProfile, fromIntent).

## Next steps (evidence first)

1. **Run from the worktree** (e.g. `bun run worktree:dev feat-draft-opportunities-chat` or ensure protocol server is from worktree).
2. **Reproduce:** In chat, ask "Any visual artists?" and trigger `create_opportunities` with searchQuery.
3. **Capture protocol server logs** for that request. Look for:
   - `discoverySource` and `searchQueryPreview`
   - Whether `runQueryHydeDiscovery` and `HyDE generator result` appear
   - `searchWithHydeEmbeddings raw results`: `fromProfile` and `fromIntent`
4. **If fromProfile and fromIntent are both 0:** Run `SELECT source_type, strategy, source_id FROM hyde_documents WHERE source_type = 'profile' LIMIT 20` and confirm Yuki’s `user_id` appears and that she’s in the same index(es) as the viewer.
5. **Share the log snippet** so we can fix the exact failing component (no code path, empty HyDE, or empty DB).

## Slowness

- **Cause:** Query HyDE path calls `hydeGenerator.invoke` with `sourceType: 'query'`, which uses the HyDE graph: **LLM** to generate hypothetical documents for "visual artists" (mirror + reciprocal), then **embedding** calls. First request is slow; cache (Redis) helps on repeat.
- **Options (after fixing 0 results):** Keep cache; optionally add a short TTL or prewarm for common queries; or accept first-query latency and document it.

## Fix strategy (after evidence)

- **If A:** Fix graph routing so profile path with searchQuery always calls `runQueryHydeDiscovery` (or ensure state is set correctly from the tool).
- **If B:** Fix HyDE generator/cache for query source (error handling, validation, or fallback).
- **If C:** Ensure profile HyDE is created for all index members: run backfill `bun run maintenance:backfill-profile-hyde` and/or ensure seed’s `embedTesterProfiles` and workers run and succeed; verify `hyde_documents` rows.
- **If D:** Tune minScore or improve HyDE prompts/embeddings.

No code fix should be applied until logs (or DB) confirm which of A–D is true.
