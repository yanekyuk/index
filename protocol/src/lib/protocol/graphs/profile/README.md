# Profile Graph

The Profile graph loads or generates a user profile, embeds it, and optionally generates and embeds a HyDE description. It supports **query** (read-only), **write** (generate/update from text), and **generate** (auto-create from user table data via Parallels API) modes with conditional routing so expensive steps are skipped when data already exists.

## Overview

**Flow (conditional):**

- **query mode**: check_state → END (return existing profile; no generation).
- **generate mode** (primary creation path): check_state → auto_generate (Parallels searchUser) → generate_profile → embed_save_profile → generate_hyde → embed_save_hyde → END. Uses user table fields (name, email, socials, location) to find web information and auto-create the profile.
- **write mode** (update path):
  - check_state → scrape | generate_profile | embed_save_profile | generate_hyde | embed_save_hyde | END
  - Scrape only when profile is missing and there is no meaningful user input.
  - Generate profile when missing (or forceUpdate + meaningful input).
  - Embed and save profile when profile exists but embedding is missing.
  - Generate HyDE when profile exists but hydeDescription is missing (or forceUpdate).
  - Embed and save HyDE when hydeDescription exists but hydeEmbedding is missing.

**Nodes:** check_state, auto_generate, scrape, generate_profile, embed_save_profile, generate_hyde, embed_save_hyde.

## When to use

- **Profile creation** (`generate` mode): When the user asks to create a profile. The `create_user_profile` chat tool invokes this graph in `generate` mode, which uses the user's account data (name, email, socials) to auto-generate a profile via web search. If user info is insufficient, the tool asks conversationally and updates the user record before retrying.
- **Profile update** (`write` mode): When the user asks to update their profile. The `update_user_profile` chat tool (via confirm_action) invokes this graph in `write` mode with the user's requested changes.
- **Profile read** (`query` mode): When the chat agent needs to check if a profile exists or display it.

## Dependencies

- **database**: `ProfileGraphDatabase` (getProfile, getUser, updateUser, saveProfile, saveHydeProfile, getProfileByUserId)
- **embedder**: `Embedder` (generate)
- **scraper**: `Scraper` (scrape(objective) for web data when no input)

## Input

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `userId` | string | Yes | User to load or generate profile for |
| `operationMode` | `'query' \| 'write' \| 'generate'` | No | Default `'write'`. Use `'query'` for read-only, `'generate'` for auto-creation from user data. |
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

### Generate mode (primary creation path)

```typescript
const result = await graph.invoke({
  userId: 'user-123',
  operationMode: 'generate',
  forceUpdate: true,
});
// Uses user table data (name, email, socials) → Parallels searchUser → ProfileGenerator
// result.profile → generated profile
// If insufficient info: result.needsUserInfo === true, result.missingUserInfo → ['social_urls', 'full_name']
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

- **Chat tools**: `graphs/chat/chat.tools.ts` — `read_user_profiles` (query mode), `create_user_profile` (generate mode), `update_user_profile` (write mode via confirm_action) call this graph.
- **Profile controller**: `src/controllers/profile.controller.ts`
- **ProfileGenerator**: `agents/profile/profile.generator.ts`
- **HydeGenerator** (profile): `agents/profile/hyde/hyde.generator.ts`
- **Parallels API**: `lib/parallel/parallel.ts` — `searchUser` used by auto_generate node in generate mode.
