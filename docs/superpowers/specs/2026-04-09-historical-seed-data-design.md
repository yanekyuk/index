# Historical Figure Seed Data with Personal Agents — Design Spec

**Goal:** Replace the 78 generic seed personas with 50 deceased historical figures, each with a personal agent and API key, to enable realistic identity-query testing and personal agent dispatch testing.

**Architecture:** Data-only changes to the seed script and test data file, plus a personal agent creation loop that uses the existing `AgentTokenAdapter`.

**Tech Stack:** Drizzle ORM, Bun, TypeScript

---

## Problem Statement

The current seed data uses 78 fictional tech personas (Alex Chen, Jordan Lee, etc.) with generic bios. This causes two problems:

1. **Identity queries are untestable**: Searching "samurai", "investors", or "scientists" returns no meaningful matches because all personas are variations of "full-stack engineer" or "product designer."
2. **Personal agents don't exist**: The seed only creates system agents. There's no way to test the dispatcher's fallback behavior (personal agent disconnected → system negotiator) or to authenticate as a personal agent via API key.

## Changes

### 1. Replace Test Data — 50 Historical Figures

**File:** `backend/src/cli/test-data.ts`

Replace the `TESTER_PERSONAS` array with 50 deceased historical figures. Update `TESTER_PERSONAS_MAX` to 50.

The `TesterPersona` and `SeedProfile` interfaces are unchanged.

**Persona selection criteria:**

- **Identity diversity**: Warriors (samurai, knights, generals), scientists, artists, investors/merchants, philosophers, explorers, musicians, athletes, political leaders, writers, architects, mathematicians — so identity queries return real matches
- **Geographic diversity**: Europe, Asia, Africa, Americas, Middle East
- **Temporal diversity**: Ancient through 20th century
- **Cross-index coverage**: Personas that naturally span the seed indexes (Stack, Latent, Pixel, Launch, Atelier, Arena, Syllabus, Reps, Tribe, Bench)

**Per-persona data shape** (unchanged interface):

- `name`: Real historical name
- `email`: `seed-tester-{N}@index-network.test` (same pattern)
- `linkedin`/`github`/`x`/`website`: `null` for all (historical figures don't have social accounts)
- `profile.identity.name`: Real name
- `profile.identity.bio`: 1-2 sentences capturing their primary professional identity, written as if alive
- `profile.identity.location`: City/region where they were most active
- `profile.narrative.context`: In-character statement of what they'd be seeking on a discovery network
- `profile.attributes.interests`: Real interests from their life (3-5 items)
- `profile.attributes.skills`: Real skills/competencies (3-5 items)
- `intents`: 2-3 intents written as if the person were alive and using the platform

### 2. Personal Agent + API Key Creation

**File:** `backend/src/cli/db-seed.ts`

After creating persona users and their profiles, add a new phase:

1. For each persona user, insert a personal agent:
   - `type: 'personal'`
   - `ownerId: user.id`
   - `name: "{HistoricalName}'s Agent"`
   - `status: 'active'`
2. Insert `agent_permissions` with global scope and full actions: `['manage:profile', 'manage:intents', 'manage:networks', 'manage:contacts', 'manage:negotiations']`
3. Call `AgentTokenAdapter.create(userId, { name: "{Name}'s API Key", agentId })` to generate and store a hashed API key. Collect the plaintext key.
4. No `agent_transports` row is created — agents exist but have no transport.

After all personas are processed, write plaintext keys to `.seed-api-keys.json` in the backend directory:

```json
[
  {
    "name": "Ada Lovelace",
    "email": "seed-tester-1@index-network.test",
    "userId": "uuid-here",
    "agentId": "uuid-here",
    "apiKey": "plaintext-key-here"
  }
]
```

Print the file path to stdout at the end of the seed run.

### 3. Gitignore the Key File

**File:** `backend/.gitignore`

Add `.seed-api-keys.json` to prevent accidental commit of plaintext API keys.

## What This Does NOT Change

- **Seed indexes**: All 12 indexes (Commons, Vault, Stack, Latent, etc.) remain the same.
- **System admin accounts**: yanki, seref, seren are unchanged.
- **System agents**: Chat Orchestrator and Negotiator seeding is unchanged.
- **Intent creation flow**: Still uses `intentService.createIntentForSeed()` with embed + HyDE.
- **Profile embedding**: Still uses `profileService.embedTesterProfiles()`.
- **`TesterPersona` / `SeedProfile` interfaces**: No schema changes.
- **CLI flags**: `--personas`, `--silent`, `--confirm` all work the same (max changes from 78 to 50).

## Test Scenarios Enabled

| Scenario | How It Works |
|----------|-------------|
| Identity query "samurai" | Miyamoto Musashi, Tomoe Gozen, etc. are real samurai — evaluator should score high on IS-A gate |
| Identity query "investors" | J.P. Morgan, Mansa Musa, etc. are real financiers/merchants |
| Disconnected personal agent fallback | Personal agent exists (`hasPersonalAgent()` = true), no transport → dispatcher falls back to system negotiator |
| Connected personal agent via MCP | User connects MCP app using API key from `.seed-api-keys.json` → MCP transport created at connection time → dispatcher routes to personal agent |
| API authentication as agent | Use plaintext key from `.seed-api-keys.json` in `Authorization: Bearer` header with `metadata.agentId` |
