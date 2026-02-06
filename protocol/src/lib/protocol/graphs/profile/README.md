# Profile Graph

The Profile graph loads or generates a user profile, embeds it, and optionally generates and embeds a HyDE description. It supports **query** (read-only) and **write** (generate/update) modes with conditional routing so expensive steps are skipped when data already exists.

## Overview

**Flow (conditional):**

- **query mode**: check_state → END (return existing profile; no generation).
- **write mode**:
  - check_state → scrape | generate_profile | embed_save_profile | generate_hyde | embed_save_hyde | END
  - Scrape only when profile is missing and there is no meaningful user input.
  - Generate profile when missing (or forceUpdate + meaningful input).
  - Embed and save profile when profile exists but embedding is missing.
  - Generate HyDE when profile exists but hydeDescription is missing (or forceUpdate).
  - Embed and save HyDE when hydeDescription exists but hydeEmbedding is missing.

**Nodes:** check_state, scrape, generate_profile, embed_save_profile, generate_hyde, embed_save_hyde.

## When to use

- **Profile API**: Get or create/update profile (e.g. GET/POST profile controller).
- **Chat tools**: When the user asks to create or update their profile, the chat graph calls this graph via profile tools (update requires user confirmation via `confirm_action`).

## Dependencies

- **database**: `ProfileGraphDatabase` (getProfile, getUser, saveProfile, saveHydeProfile)
- **embedder**: `Embedder` (generate)
- **scraper**: `Scraper` (scrape(objective) for web data when no input)

## Input

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `userId` | string | Yes | User to load or generate profile for |
| `operationMode` | `'query' \| 'write'` | No | Default `'write'`. Use `'query'` for read-only. |
| `forceUpdate` | boolean | No | When true with input, re-generate and update profile (default: false) |
| `input` | string | No | User-provided text for profile (or scraped content from scrape node) |

## Output

State after `invoke`:

| Field | Type | Description |
|-------|------|-------------|
| `profile` | `ProfileDocument \| undefined` | Loaded or generated profile (identity, narrative, attributes, embedding) |
| `error` | string \| undefined | Error message if a step failed |
| `needsUserInfo` | boolean | True when user has insufficient data for scraping (e.g. no socials, no full name) |
| `missingUserInfo` | string[] | e.g. `['social_urls', 'full_name', 'location']` |
| `operationsPerformed` | object | `{ scraped?, generatedProfile?, embeddedProfile?, generatedHyde?, embeddedHyde? }` |

## Code samples

### Query mode (fast path: load only)

```typescript
import { ProfileGraphFactory } from './profile.graph';

const factory = new ProfileGraphFactory(database, embedder, scraper);
const graph = factory.createGraph();

const result = await graph.invoke({
  userId: 'user-123',
  operationMode: 'query',
});

// result.profile → existing profile or undefined
// No embedder/scraper calls
```

### Write mode: generate profile when missing

```typescript
const result = await graph.invoke({
  userId: 'user-123',
  operationMode: 'write',
  input: 'Senior engineer, 10 years React, interested in AI and open source.',
});
// result.profile → generated profile; result.operationsPerformed.generatedProfile === true
```

### Write mode: update existing profile

```typescript
const result = await graph.invoke({
  userId: 'user-123',
  operationMode: 'write',
  forceUpdate: true,
  input: 'Add Python and ML to my skills.',
});
// Merges with existing profile; HyDE is regenerated
```

### Example input (query)

```typescript
{ userId: 'user-123', operationMode: 'query' }
```

### Example output (query, profile exists)

```json
{
  "profile": {
    "userId": "user-123",
    "identity": { "name": "Alice", "bio": "...", "location": "SF" },
    "narrative": { "context": "..." },
    "attributes": { "skills": ["React", "Node"], "interests": ["AI"] },
    "embedding": [0.01, -0.02, ...]
  }
}
```

### Example output (write, generation performed)

```json
{
  "profile": { ... },
  "operationsPerformed": {
    "generatedProfile": true,
    "embeddedProfile": true,
    "generatedHyde": true,
    "embeddedHyde": true
  }
}
```

### Example output (insufficient user info for scraping)

```json
{
  "profile": undefined,
  "needsUserInfo": true,
  "missingUserInfo": ["social_urls", "full_name"]
}
```

## File structure

```
graphs/profile/
├── profile.graph.ts       # ProfileGraphFactory, nodes, conditional edges
├── profile.graph.state.ts # ProfileGraphState annotation
├── profile.graph.spec.ts  # Tests
└── README.md              # This file
```

## Related

- **Chat tools**: `graphs/chat/chat.tools.ts` — read_user_profiles, create_user_profile, update_user_profile call this graph.
- **Profile controller**: `src/controllers/profile.controller.ts`
- **ProfileGenerator**: `agents/profile/profile.generator.ts`
- **HydeGenerator** (profile): `agents/profile/hyde/hyde.generator.ts`
