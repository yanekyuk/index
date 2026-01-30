# Profile Graph Flow Diagram

## Overview Flow

```
                                    ┌──────────┐
                                    │  START   │
                                    └────┬─────┘
                                         │
                                         ▼
                                 ┌───────────────┐
                                 │ check_state   │
                                 │ (Load Profile)│
                                 └───────┬───────┘
                                         │
                     ┌───────────────────┴────────────────────┐
                     │                                         │
              Query Mode?                                 Write Mode
                     │                                         │
                     ▼                                         ▼
                  ┌─────┐                              [Detect Missing]
                  │ END │                                      │
                  └─────┘         ┌────────────────────────────┼────────────────────────────┐
                                  │                            │                            │
                          Profile Missing?            Embedding Missing?              Hyde Missing?
                                  │                            │                            │
                                  ▼                            ▼                            ▼
                         ┌─────────────────┐         ┌──────────────────┐        ┌──────────────────┐
                         │ Has Input?      │         │ embed_save       │        │ generate_hyde    │
                         └────┬────────┬───┘         │ _profile         │        └────────┬─────────┘
                              │        │             └─────────┬────────┘                 │
                          Yes │        │ No                    │                          │
                              │        │                       │                          │
                              ▼        ▼                       ▼                          ▼
                    ┌──────────────┐  ┌────────┐    ┌─────────────────┐      ┌────────────────────┐
                    │ generate     │  │ scrape │    │ generate_hyde   │      │ embed_save_hyde    │
                    │ _profile     │  └───┬────┘    │ (auto-trigger)  │      └──────────┬─────────┘
                    └──────┬───────┘      │         └────────┬────────┘                 │
                           │              │                  │                           │
                           │              ▼                  ▼                           │
                           │      ┌──────────────┐   ┌────────────────┐                │
                           │      │ generate     │   │ embed_save     │                │
                           │      │ _profile     │   │ _hyde          │                │
                           │      └──────┬───────┘   └───────┬────────┘                │
                           │             │                   │                          │
                           └─────────────┴───────────────────┴──────────────────────────┘
                                                     │
                                                     ▼
                                                 ┌───────┐
                                                 │  END  │
                                                 └───────┘
```

## Detailed Scenarios

### Scenario 1: Query Mode (Fast Path)

```
START
  │
  ▼
check_state (operationMode: 'query')
  │
  ├─ Load profile from DB
  │
  ▼
END (return profile immediately)

Time: ~100ms
Cost: 1 DB query
```

### Scenario 2: New Profile (No Input Provided)

```
START
  │
  ▼
check_state (operationMode: 'write')
  │
  ├─ No profile found
  ├─ needsProfileGeneration: true
  │
  ▼
scrape
  │
  ├─ Fetch user socials
  ├─ Build objective
  ├─ Call scraper API
  │
  ▼
generate_profile
  │
  ├─ Call ProfileGenerator agent
  ├─ Generate structured profile
  │
  ▼
embed_save_profile
  │
  ├─ Generate profile embedding
  ├─ Save to DB
  │
  ▼
generate_hyde (auto-triggered)
  │
  ├─ Call HydeGenerator agent
  ├─ Generate complementary match description
  │
  ▼
embed_save_hyde
  │
  ├─ Generate hyde embedding
  ├─ Save to DB
  │
  ▼
END

Time: ~10-15s
Cost: 2 LLM calls + 2 embeddings + 1 scrape
```

### Scenario 3: Profile Exists, Embedding Missing

```
START
  │
  ▼
check_state (operationMode: 'write')
  │
  ├─ Profile found
  ├─ needsProfileEmbedding: true
  │
  ▼
embed_save_profile
  │
  ├─ Generate profile embedding
  ├─ Save to DB
  │
  ▼
generate_hyde (auto-triggered)
  │
  ├─ Call HydeGenerator agent
  │
  ▼
embed_save_hyde
  │
  ├─ Generate hyde embedding
  ├─ Save to DB
  │
  ▼
END

Time: ~2-3s
Cost: 1 LLM call + 2 embeddings
Savings: ~80% vs full regeneration
```

### Scenario 4: Profile & Embedding Exist, Hyde Missing

```
START
  │
  ▼
check_state (operationMode: 'write')
  │
  ├─ Profile found with embedding
  ├─ needsHydeGeneration: true
  │
  ▼
generate_hyde
  │
  ├─ Call HydeGenerator agent
  │
  ▼
embed_save_hyde
  │
  ├─ Generate hyde embedding
  ├─ Save to DB
  │
  ▼
END

Time: ~2-3s
Cost: 1 LLM call + 1 embedding
Savings: ~85% vs full regeneration
```

### Scenario 5: Everything Exists, Hyde Embedding Missing

```
START
  │
  ▼
check_state (operationMode: 'write')
  │
  ├─ Profile found with embedding
  ├─ Hyde description found
  ├─ needsHydeEmbedding: true
  │
  ▼
embed_save_hyde
  │
  ├─ Generate hyde embedding
  ├─ Save to DB
  │
  ▼
END

Time: ~1s
Cost: 1 embedding
Savings: ~95% vs full regeneration
```

### Scenario 6: Force Update with New Input

```
START
  │
  ▼
check_state (operationMode: 'write', forceUpdate: true)
  │
  ├─ Profile found
  ├─ New input provided
  ├─ needsProfileGeneration: true (forced)
  ├─ needsHydeGeneration: true (forced)
  │
  ▼
generate_profile
  │
  ├─ Merge existing profile with new input
  ├─ Call ProfileGenerator agent
  │
  ▼
embed_save_profile
  │
  ├─ Generate updated profile embedding
  ├─ Save to DB
  │
  ▼
generate_hyde (auto-triggered because profile updated)
  │
  ├─ Call HydeGenerator agent with updated profile
  │
  ▼
embed_save_hyde
  │
  ├─ Generate updated hyde embedding
  ├─ Save to DB
  │
  ▼
END

Time: ~10-15s
Cost: 2 LLM calls + 2 embeddings
Note: Expected full pipeline for profile updates
```

### Scenario 7: Everything Complete (Already Up-to-Date)

```
START
  │
  ▼
check_state (operationMode: 'write')
  │
  ├─ Profile found with embedding
  ├─ Hyde found with embedding
  ├─ All components complete
  │
  ▼
END (return profile immediately)

Time: ~100ms
Cost: 1 DB query
Savings: 100% vs unnecessary regeneration
```

## Conditional Routing Decision Tree

```
check_state
    │
    ├─ operationMode === 'query'? ──> END (Fast Path)
    │
    └─ operationMode === 'write'
        │
        ├─ needsProfileGeneration?
        │   ├─ Yes + has input? ──> generate_profile
        │   └─ Yes + no input? ──> scrape ──> generate_profile
        │
        ├─ needsProfileEmbedding? ──> embed_save_profile
        │
        ├─ needsHydeGeneration? ──> generate_hyde
        │
        ├─ needsHydeEmbedding? ──> embed_save_hyde
        │
        └─ All complete? ──> END
```

## State Transitions

```
Initial State:
{
  userId: "user-123",
  operationMode: "write",
  profile: undefined,
  needsProfileGeneration: false,
  needsProfileEmbedding: false,
  needsHydeGeneration: false,
  needsHydeEmbedding: false
}

After check_state (profile missing):
{
  userId: "user-123",
  operationMode: "write",
  profile: undefined,
  needsProfileGeneration: true,    // ← Detected
  needsProfileEmbedding: null,
  needsHydeGeneration: true,       // ← Detected
  needsHydeEmbedding: null
}

After generate_profile:
{
  userId: "user-123",
  operationMode: "write",
  profile: { ... },                // ← Generated
  needsProfileGeneration: true,
  needsProfileEmbedding: false,
  needsHydeGeneration: true,       // ← Auto-set (profile updated)
  needsHydeEmbedding: null
}

After embed_save_profile:
{
  userId: "user-123",
  operationMode: "write",
  profile: { ..., embedding: [...] },  // ← Embedded
  needsProfileGeneration: true,
  needsProfileEmbedding: false,
  needsHydeGeneration: true,
  needsHydeEmbedding: null
}

After generate_hyde:
{
  userId: "user-123",
  operationMode: "write",
  profile: { ..., embedding: [...] },
  hydeDescription: "...",          // ← Generated
  needsProfileGeneration: true,
  needsProfileEmbedding: false,
  needsHydeGeneration: true,
  needsHydeEmbedding: false
}

After embed_save_hyde (Final):
{
  userId: "user-123",
  operationMode: "write",
  profile: { ..., embedding: [...] },
  hydeDescription: "...",
  needsProfileGeneration: true,
  needsProfileEmbedding: false,
  needsHydeGeneration: true,
  needsHydeEmbedding: false
}
```

## Key Design Decisions

### 1. **Auto-Regenerate Hyde on Profile Update**

When profile is generated or updated, `needsHydeGeneration` is automatically set to `true` because:
- Hyde is a complementary match description based on the profile
- If profile changes, hyde should reflect those changes
- Stale hyde leads to poor matching results

### 2. **Separate Embedding Checks**

Profile embedding and hyde embedding are checked separately because:
- They can fail independently (API errors, timeouts)
- They have different dimensions/purposes
- Allows recovery from partial failures

### 3. **Query Mode Short-Circuit**

Query mode immediately returns after `check_state` because:
- Read operations shouldn't trigger writes
- Prevents accidental expensive operations
- Clear separation of concerns

### 4. **Input vs. Scrape**

Input is checked before scraping because:
- External scraping is expensive and slow
- User-provided input is more reliable
- Allows manual profile updates without scraping

---

**Note**: All timing estimates are approximate and depend on:
- LLM API response times
- Network latency
- Database query performance
- Embedding generation speed
