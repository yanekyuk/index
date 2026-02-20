# Index Protocol — Implementation Design

A complete redesign of the Index Protocol server to implement the conceptual architecture defined in `protocol/ARCHITECTURE.md`. The server becomes a self-deployable OAuth 2.0 Authorization Server with A2A agent interoperability, wrapping the existing LangGraph/LangChain core.

---

## Decisions

| Decision | Choice |
|----------|--------|
| Scope | Full protocol implementation (ARCHITECTURE.md sections 1-7, 9, 10; skip cross-network) |
| Server model | Self-deployable, isolated instances. Each deployment is one server. |
| Auth | Token-only. No cookies. OAuth 2.0 Authorization Server. |
| Agent entity | An OAuth client. No separate abstraction. |
| Agent communication | Google A2A protocol (discovery + messaging). Complementary to OAuth (authorization). |
| Scopes | Three levels: `user`, `index:<id>`, `index:<id>:admin` |
| Index governance | All three modes: open-access, request-based, invite-only |
| Core services | Existing LangGraph pipelines, services, graphs stay unchanged |
| Job processing | BullMQ remains for internal processing. A2A tasks for external request tracking. |
| Admin | No admin role. Deployer controls the server directly. |

---

## 1. System Architecture

Three entry points, one auth guard, same core.

- **OAuth 2.0 Auth Server** — Token issuance, client registration, token exchange
- **A2A Gateway** — Agent discovery (AgentCard) and JSON-RPC messaging
- **REST API** — Existing resource endpoints (intents, indexes, chat, profiles, opportunities)

```
┌──────────────────────────────────────────────────────────────┐
│                        INDEX SERVER                           │
│                                                               │
│  ┌──────────────┐  ┌──────────────┐  ┌────────────────────┐  │
│  │  OAuth 2.0   │  │   A2A        │  │   REST API         │  │
│  │  Auth Server  │  │   Gateway    │  │   (existing)       │  │
│  │              │  │              │  │                    │  │
│  │ /oauth/      │  │ /.well-known │  │ /api/intents      │  │
│  │  authorize   │  │  /agent.json │  │ /api/indexes      │  │
│  │  token       │  │ /a2a         │  │ /api/chat         │  │
│  │  register    │  │              │  │ /api/profiles     │  │
│  └──────┬───────┘  └──────┬───────┘  └────────┬───────────┘  │
│         │                 │                    │              │
│         └─────────────────┼────────────────────┘              │
│                           │                                   │
│              ┌────────────▼──────────────┐                    │
│              │       Auth Guard          │                    │
│              │   (Bearer JWT → user +    │                    │
│              │    scopes validation)     │                    │
│              └────────────┬──────────────┘                    │
│                           │                                   │
│              ┌────────────▼──────────────┐                    │
│              │     Services / Graphs     │                    │
│              │     (existing core —      │                    │
│              │      unchanged)           │                    │
│              └────────────┬──────────────┘                    │
│                           │                                   │
│         ┌─────────────────┼──────────────────┐                │
│         │                 │                  │                │
│    ┌────▼─────┐   ┌──────▼───────┐   ┌──────▼──────┐        │
│    │PostgreSQL │   │    Redis     │   │  OpenRouter  │        │
│    │ +pgvector │   │   (BullMQ)  │   │    (LLM)    │        │
│    └──────────┘   └──────────────┘   └─────────────┘        │
└──────────────────────────────────────────────────────────────┘
```

All three entry points converge at the same auth guard, which validates Bearer JWT tokens and extracts user identity + scopes. The existing services, graphs, agents, and queues are untouched.

---

## 2. OAuth 2.0 Authorization Server

The server implements a standard OAuth 2.0 Authorization Server. Token-only authentication for all clients — humans and agents alike.

### Clients

Any software (web frontend, agent, bot, CLI) registers as an OAuth client.

| Client type | Example | Auth method |
|-------------|---------|-------------|
| **Public** | Web frontend (SPA) | PKCE, no secret |
| **Confidential** | Server-side agent, bot | `client_secret` |

### Grants

| Grant | Who uses it | When |
|-------|-------------|------|
| **Authorization Code + PKCE** | All clients (humans and agents that can redirect) | User logs in, authorizes the client |
| **Client Credentials** | Machine-to-machine agents that already hold a user's PAT | Server-to-server calls |

### Scopes

Three levels. Simple and sufficient.

| Scope | What it unlocks |
|-------|----------------|
| `user` | Full access to own data: profile, intents, chat, opportunities, index memberships |
| `index:<id>` | Access to a specific index's shared data: members, linked intents, collaboration |
| `index:<id>:admin` | Manage that index: invite/remove members, change access mode |

A token with `user` scope can access all of the user's own data. Index scopes unlock access to shared index resources.

**Examples:**

```
Personal agent:        scope = "user"
Index-specific bot:    scope = "user index:550e8400-..."
Index admin tool:      scope = "user index:550e8400-...:admin"
```

### Token Exchange for Index Access

When a client needs to operate within an index, it exchanges its token for a scoped one (RFC 8693):

```
POST /oauth/token
grant_type=urn:ietf:params:oauth:grant-type:token-exchange
subject_token=<current_access_token>
scope=index:<id>
```

Server checks membership -> issues scoped token. When membership is revoked, all scoped tokens for that user+index are invalidated.

### Personal Access Tokens (PATs)

Users create PATs to give agents long-lived access without the authorization code flow:

```
POST /api/tokens
{ "name": "My Agent", "scopes": ["user"] }
-> { "token": "idx_pat_..." }
```

A PAT is an access token with a long expiry, tied to the user, with selected scopes.

### Token Format

JWTs signed by the server:

```json
{
  "iss": "https://index.example.com",
  "sub": "user_abc123",
  "client_id": "agent_xyz",
  "scope": "user index:550e8400-e29b-41d4-a716-446655440000",
  "exp": 1708304400
}
```

### Access Ladder

```
Level 1 — client_id only
  -> Can discover server metadata, read public info

Level 2 — client_id + user scope
  -> Can act as user: CRUD own intents, profile, chat
  -> Can see all own intents regardless of index

Level 3 — client_id + user scope + index scope
  -> Can operate within index: see linked intents,
     other members' scoped data, collaborate
```

### Human Auth Flow (Web Frontend)

```
1. Frontend redirects to /oauth/authorize
   ?client_id=index-web&response_type=code&code_challenge=...
2. Server shows login form (Better Auth handles identity)
3. User authenticates -> server issues authorization code
4. Frontend exchanges code for access_token + refresh_token
5. Frontend stores tokens in memory
6. All API calls: Authorization: Bearer <access_token>
7. Token expires -> frontend uses refresh_token silently
```

### Agent Auth Flow

```
1. Agent registers: POST /oauth/register -> gets client_id + client_secret
2. User creates PAT in web UI or agent goes through OAuth consent
3. Agent calls API: Authorization: Bearer <token>
4. Agent needs index access: token exchange -> scoped token
```

---

## 3. A2A Integration

A2A is the discovery and communication layer for agents. OAuth handles authorization. They are complementary.

- **A2A** answers: "What can you do and how do we talk?"
- **OAuth** answers: "Are you allowed to do this?"

### AgentCard (Discovery)

Published at `/.well-known/agent.json`:

```json
{
  "name": "Index Server",
  "description": "Intent-driven discovery protocol",
  "url": "https://index.example.com",
  "version": "1.0.0",
  "capabilities": { "streaming": true },
  "authentication": {
    "schemes": ["OAuth2"],
    "credentials": {
      "oauth2": {
        "authorization_url": "/oauth/authorize",
        "token_url": "/oauth/token",
        "registration_url": "/oauth/register",
        "scopes": {
          "user": "Full access to own data",
          "index:{id}": "Access a specific index",
          "index:{id}:admin": "Manage an index"
        }
      }
    }
  },
  "skills": [
    {
      "id": "chat",
      "name": "Conversational Discovery",
      "description": "Multi-turn AI chat with intent discovery"
    },
    {
      "id": "intents",
      "name": "Intent Management",
      "description": "Create, read, update intents"
    },
    {
      "id": "opportunities",
      "name": "Opportunity Discovery",
      "description": "Find matching opportunities between users"
    },
    {
      "id": "indexes",
      "name": "Index Management",
      "description": "Join, leave, manage index memberships"
    },
    {
      "id": "profile",
      "name": "Profile Management",
      "description": "Read and update user profiles"
    }
  ],
  "defaultInputModes": ["text/plain", "application/json"],
  "defaultOutputModes": ["text/plain", "application/json"]
}
```

### A2A Message Flow

```
External Agent                    Index Server
     |                                 |
     |  1. GET /.well-known/agent.json |
     |  ------------------------------>|  Discover capabilities
     |  <------------------------------|
     |                                 |
     |  2. POST /oauth/register        |
     |  ------------------------------>|  Register as client
     |  <------------------------------|
     |                                 |
     |  3. OAuth flow -> access_token  |  Get authorized
     |  <----------------------------->|
     |                                 |
     |  4. POST /a2a (JSON-RPC)        |
     |     Authorization: Bearer <tok> |
     |     { method: "message/send",   |
     |       params: { message: ... }} |
     |  ------------------------------>|  Send A2A message
     |                                 |
     |     { result: { task: ... } }   |  Task created
     |  <------------------------------|
```

### A2A Executor

The A2A executor routes A2A messages to existing services:

```
A2A Message -> Skill routing -> Service call -> Response

"Create an intent about AI research"
  -> skill: "intents" -> IntentService.create(...)
  -> A2A Task with result

"Find opportunities for me"
  -> skill: "opportunities" -> OpportunityService.discover(...)
  -> A2A Task with streaming updates

"Let's chat about my network"
  -> skill: "chat" -> ChatGraphFactory.invoke(...)
  -> A2A Task with SSE stream
```

The executor is a thin adapter. It translates A2A messages into calls to the same services the REST API uses.

### A2A Tasks vs BullMQ

| | BullMQ | A2A Tasks |
|---|--------|-----------|
| **Purpose** | Internal background job processing | External-facing request tracking |
| **Who sees it** | Only the server (internal) | The agent who made the request |
| **Examples** | Re-index embeddings, send email | Agent asked to find opportunities |

A single agent request may create an A2A Task AND enqueue a BullMQ job:

```
Agent: "Process my intents"
  -> A2A Task created (agent can poll status)
    -> BullMQ job enqueued (internal processing)
      -> Worker completes job
    -> A2A Task updated to "completed" (agent sees result)
```

BullMQ is the engine. A2A Task is the ticket the agent holds.

---

## 4. Index Governance

Three access modes, controlled by index admins (the creator is the first admin).

### Access Modes

**Open-access:** Any authenticated user can join.

```
Client (scope: "user")             Server
  |  POST /api/indexes/<id>/join     |
  |  ------------------------------>  |  Checks: mode = open?
  |                                  |  Yes -> adds membership
  |  { membership: "active" }        |
  |  <------------------------------  |
  |  Token exchange for index:<id>   |  Now client can get index scope
```

**Request-based:** User requests, admin approves or denies.

```
Client -> POST /api/indexes/<id>/request -> pending
Admin  -> POST /api/indexes/<id>/approve/<user_id> -> active
```

**Invite-only:** Admin invites, user accepts.

```
Admin  -> POST /api/indexes/<id>/invite { user_id } -> invited
User   -> POST /api/indexes/<id>/accept -> active
```

### Admin Capabilities

- Invite/remove members
- Approve/deny access requests
- Change access mode (open, request, invite)
- Grant/revoke admin to other members

### Membership Revocation

When a user's membership is revoked:
1. Membership row marked inactive
2. All existing `index:<id>` tokens for that user are invalidated
3. User's intents are unlinked from that index
4. User's base `user` token remains valid

---

## 5. Database Schema Changes

### New Tables

**`oauth_clients`** — Registered clients (agents, apps, frontend)

| Column | Type | Description |
|--------|------|-------------|
| `id` | text | PK |
| `name` | text | Display name |
| `secret_hash` | text | Nullable (null for public clients) |
| `redirect_uris` | jsonb | Allowed redirect URIs |
| `client_type` | text | `"public"` or `"confidential"` |
| `owner_id` | text | FK -> users.id |
| `created_at` | timestamp | |

**`access_tokens`** — Issued tokens (for validation and revocation)

| Column | Type | Description |
|--------|------|-------------|
| `id` | text | PK (jti claim) |
| `user_id` | text | FK -> users.id |
| `client_id` | text | FK -> oauth_clients.id |
| `scopes` | text[] | `["user", "index:abc123"]` |
| `token_hash` | text | For revocation lookup |
| `expires_at` | timestamp | |
| `revoked_at` | timestamp | Nullable |
| `created_at` | timestamp | |

**`personal_access_tokens`** — User-created PATs

| Column | Type | Description |
|--------|------|-------------|
| `id` | text | PK |
| `user_id` | text | FK -> users.id |
| `name` | text | Display name |
| `token_hash` | text | For lookup |
| `scopes` | text[] | `["user"]` |
| `last_used_at` | timestamp | Nullable |
| `expires_at` | timestamp | Nullable |
| `revoked_at` | timestamp | Nullable |
| `created_at` | timestamp | |

**`authorization_codes`** — Temporary codes for OAuth flow

| Column | Type | Description |
|--------|------|-------------|
| `code` | text | PK |
| `client_id` | text | FK -> oauth_clients.id |
| `user_id` | text | FK -> users.id |
| `scopes` | text[] | |
| `code_challenge` | text | PKCE |
| `redirect_uri` | text | |
| `expires_at` | timestamp | |
| `used_at` | timestamp | Nullable |

**`a2a_tasks`** — A2A task state

| Column | Type | Description |
|--------|------|-------------|
| `id` | text | PK |
| `context_id` | text | A2A context |
| `user_id` | text | FK -> users.id |
| `status` | jsonb | A2A task status |
| `artifacts` | jsonb | |
| `history` | jsonb | |
| `metadata` | jsonb | |
| `created_at` | timestamp | |
| `updated_at` | timestamp | |

### Modified Tables

**`indexes`** — Add governance:

| Column | Type | Description |
|--------|------|-------------|
| `access_mode` | text | `"open"`, `"request"`, or `"invite"` (default: `"open"`) |

**`index_members`** — Add role and status:

| Column | Type | Description |
|--------|------|-------------|
| `role` | text | `"member"` or `"admin"` (default: `"member"`) |
| `status` | text | `"active"`, `"pending"`, or `"invited"` (default: `"active"`) |

### Unchanged Tables

`users`, `sessions`, `accounts`, `verifications`, `user_profiles`, `intents`, `intent_indexes`, `intent_stakes`, `intent_stake_items`, `opportunities`, `chat_sessions`, `chat_messages`, `hyde_documents`, `files`, `links`, `user_integrations`, `agents`, `user_notification_settings`

---

## 6. Component Map

### New files

```
protocol/src/
  oauth/
    oauth.server.ts          # OAuth 2.0 Authorization Server core
    oauth.controller.ts      # /oauth/* endpoints (authorize, token, register)
    oauth.middleware.ts       # JWT validation, scope checking
    token.service.ts         # Token issuance, exchange, revocation
    pat.controller.ts        # PAT management endpoints for users
  a2a/
    agent-card.ts            # AgentCard definition
    executor.ts              # A2A message -> service routing
    task-store.ts            # PostgreSQL-backed A2A TaskStore
  schemas/
    oauth.schema.ts          # New OAuth tables (Drizzle)
```

### Modified files

| File | Change |
|------|--------|
| `src/main.ts` | Mount OAuth routes, A2A endpoints, serve AgentCard |
| `src/guards/auth.guard.ts` | Validate JWT Bearer tokens instead of Better Auth sessions |
| `src/schemas/database.schema.ts` | Add `access_mode` to indexes, `role`/`status` to index_members |
| `src/controllers/index.controller.ts` | Add join/request/invite endpoints, scope-check index access |
| `src/services/index.service.ts` | Add governance logic (access modes, membership management) |

### Frontend changes

| File | Change |
|------|--------|
| `src/lib/auth-client.ts` | Switch from Better Auth session to OAuth token flow |
| `src/lib/api.ts` | Send `Authorization: Bearer <token>` instead of cookies |
| `src/contexts/AuthContext.tsx` | Store tokens in memory, handle refresh flow |
| All service files | Remove any cookie/session references |

### Unchanged

All LangGraph graphs, agents, services (intent, opportunity, chat, profile), queues, adapters, and the bulk of controllers.

---

## 7. ARCHITECTURE.md Mapping

How the conceptual architecture maps to this implementation:

| ARCHITECTURE.md | Implementation |
|-----------------|---------------|
| Network | Server (self-deployed instance) |
| Person | Human user (outside the system) |
| User | Better Auth user record |
| Agent | OAuth client |
| Intent | Existing `intents` table (unchanged) |
| Index | Existing `indexes` table (+ governance fields) |
| NAT | OAuth client registration (`client_id`) |
| UAT | OAuth access token (`scope: "user"`) |
| IAT | Scoped token via token exchange (`scope: "index:<id>"`) |
| Token wallet | Set of tokens an OAuth client holds |
| Cross-network import | Deferred (single-server deployment) |
| Agent-to-agent discovery | A2A AgentCard at `/.well-known/agent.json` |
| Agent-to-agent messaging | A2A JSON-RPC at `/a2a` |
| Intent-mediated matching | Existing opportunity/broker system (unchanged) |
| Privacy model | Scope-based access control via OAuth scopes |
