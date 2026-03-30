---
trigger: "Add `index network` command to the CLI — list, create, show, join, leave, invite for networks (formerly indexes)."
type: feat
branch: feat/cli-network
base-branch: dev
created: 2026-03-30
linear-issue: IND-192
---

## Related Files
- cli/src/main.ts — entry point, command routing (add network case)
- cli/src/args.parser.ts — argument parser (add "network" command + subcommands: list, create, show, join, leave, invite)
- cli/src/api.client.ts — HTTP client (add network methods against /api/indexes/* endpoints)
- cli/src/output.ts — terminal formatting (add network list table, network detail card with members)
- protocol/src/controllers/index.controller.ts — index/network API endpoints (currently /api/indexes/*)
- cli/src/auth.store.ts — credential loading (reuse existing)

## Relevant Docs
- docs/specs/cli-v1.md — CLI v1 spec (login + chat), pattern reference
- docs/domain/indexes.md — index/network domain model (communities, permissions, join policies, personal indexes)
- docs/specs/api-reference.md — full API reference
- docs/design/cli-interaction-design.md — CLI design doc with idx/network command surface

## Related Issues
- IND-192 Rename "index" to "network" across full stack (In Review) — API routes will be renamed from /api/indexes to /api/networks
- IND-199 Design Index CLI — clarify A2A, H2A, H2H terminology (Done)

## Scope
Add `index network` command to the existing cli/ workspace with six subcommands. All user-facing copy uses "network" terminology even though the backend API currently uses /api/indexes/*. When IND-192 merges and renames the routes, only the API client paths need updating.

1. **`index network list`** — List networks the user is a member of. Calls GET /api/indexes. Renders a table with: title, member count, role (owner/admin/member), joinPolicy, createdAt. Filters out personal indexes from display (or marks them).

2. **`index network create <name>`** — Create a network. Calls POST /api/indexes with { title }. Supports optional `--prompt <text>` for the network description. Prints the created network summary.

3. **`index network show <id>`** — Show network details with members. Calls GET /api/indexes/:id for details, then GET /api/indexes/:id/members for the member list. Renders a card with: title, prompt, joinPolicy, member count, owner info, and a member table.

4. **`index network join <id>`** — Join a public network. Calls POST /api/indexes/:id/join. Prints confirmation. Errors on invite-only networks.

5. **`index network leave <id>`** — Leave a network. Calls POST /api/indexes/:id/leave. Prints confirmation. Errors if user is the owner.

6. **`index network invite <id> <email>`** — Invite a user to a network by email. This is a two-step process: first search for the user (GET /api/indexes/search-users?q=<email>&indexId=<id>), then add them (POST /api/indexes/:id/members with { userId }). Prints confirmation or "user not found".

Implementation touches:
- `args.parser.ts`: Add "network" to KNOWN_COMMANDS, parse subcommands ("list", "create", "show", "join", "leave", "invite") and positional args (id, name, email). Add --prompt flag for create.
- `api.client.ts`: Add listNetworks(), createNetwork(title, prompt?), getNetwork(id), getNetworkMembers(id), joinNetwork(id), leaveNetwork(id), searchUsers(query, indexId?), addNetworkMember(indexId, userId) methods. All hit /api/indexes/* for now.
- `main.ts`: Add "network" case in switch, wire to handler functions
- `output.ts`: Add networkTable(), networkCard(), and memberTable() renderers
- New test file: `cli/tests/network.command.test.ts`
- Update `cli/README.md` with network command docs

API notes:
- GET /api/indexes → { indexes[] } (includes personal index, filter in CLI)
- POST /api/indexes body: { title, prompt?, joinPolicy? } → { index }
- GET /api/indexes/:id → { index } (with owner info, member count)
- GET /api/indexes/:id/members → { members[], pagination }
- POST /api/indexes/:id/join → { index }
- POST /api/indexes/:id/leave → { success }
- POST /api/indexes/:id/members body: { userId } → { member, message }
- GET /api/indexes/search-users?q=<email>&indexId=<id> → { users[] }
