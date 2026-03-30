---
trigger: "Add `index profile` command to the CLI — view own profile, view another user's profile, trigger profile regeneration."
type: feat
branch: feat/cli-profile
base-branch: dev
created: 2026-03-30
---

## Related Files
- cli/src/main.ts — entry point, command routing (add profile case)
- cli/src/args.parser.ts — argument parser (add "profile" command + subcommands)
- cli/src/api.client.ts — HTTP client (add getProfile, syncProfile methods)
- cli/src/output.ts — terminal formatting (add profile card rendering)
- protocol/src/controllers/profile.controller.ts — POST /api/profiles/sync
- protocol/src/controllers/user.controller.ts — GET /api/users/:userId (profile data)
- cli/src/auth.store.ts — credential loading (reuse existing)
- cli/src/chat.command.ts — reference for command structure pattern

## Relevant Docs
- docs/specs/cli-v1.md — CLI v1 spec (login + chat), use as pattern reference
- docs/domain/profiles.md — profile structure (identity, narrative, attributes, embeddings)
- docs/specs/api-reference.md — full API reference including profile endpoints
- docs/design/cli-interaction-design.md — CLI design doc (on branch docs/cli-interaction-design)

## Related Issues
- IND-199 Design Index CLI — clarify A2A, H2A, H2H terminology (Done)

## Scope
Add `index profile` command to the existing cli/ workspace with three subcommands:

1. **`index profile`** (no args) — Show the current user's own profile. Calls GET /api/auth/me to get userId, then GET /api/users/:userId for full profile. Renders a styled card with name, intro/bio, location, socials, and ghost status.

2. **`index profile show <user-id>`** — Show another user's profile. Calls GET /api/users/:userId directly.

3. **`index profile sync`** — Trigger profile regeneration. Calls POST /api/profiles/sync. Prints confirmation when complete.

Implementation touches:
- `args.parser.ts`: Add "profile" to KNOWN_COMMANDS, parse subcommands ("show", "sync") and positional user-id
- `api.client.ts`: Add `getUser(userId)` and `syncProfile()` methods
- `main.ts`: Add "profile" case in switch, wire to handler functions
- `output.ts`: Add `profileCard()` renderer for terminal display
- New test file: `cli/tests/profile.command.test.ts`
- Update `cli/README.md` with profile command docs

The profile API returns: id, name, intro, avatar, location, socials, isGhost, createdAt, updatedAt.
