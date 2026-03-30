---
trigger: "Add `index opportunity` command to the CLI — list, show, accept, reject opportunities."
type: feat
branch: feat/cli-opportunity
base-branch: dev
created: 2026-03-30
---

## Related Files
- cli/src/main.ts — entry point, command routing (add opportunity case)
- cli/src/args.parser.ts — argument parser (add "opportunity" command + subcommands: list, show, accept, reject)
- cli/src/api.client.ts — HTTP client (add listOpportunities, getOpportunity, updateOpportunityStatus methods)
- cli/src/output.ts — terminal formatting (add opportunity list table, opportunity detail card with reasoning)
- protocol/src/controllers/opportunity.controller.ts — opportunity API endpoints
- cli/src/auth.store.ts — credential loading (reuse existing)

## Relevant Docs
- docs/specs/cli-v1.md — CLI v1 spec (login + chat), pattern reference
- docs/domain/opportunities.md — opportunity domain model (valency roles, discovery triggers, lifecycle, scoring)
- docs/specs/api-reference.md — full API reference
- docs/design/cli-interaction-design.md — CLI design doc with opportunity command surface

## Related Issues
- IND-199 Design Index CLI — clarify A2A, H2A, H2H terminology (Done)
- IND-145 Gain knowledge and refactor opportunity expiration paths (Todo) — context on opportunity lifecycle

## Scope
Add `index opportunity` command to the existing cli/ workspace with four subcommands:

1. **`index opportunity list`** — List the user's opportunities. Calls GET /api/opportunities with query params. Renders a table with: counterparty name, category, status, confidence, createdAt. Supports `--status <pending|accepted|rejected|expired>` filter and `--limit <n>`.

2. **`index opportunity show <id>`** — Show full opportunity details with presentation. Calls GET /api/opportunities/:id (returns opportunity with LLM-generated presentation text). Renders a detailed card with: parties (names + valency roles: agent/patient/peer), reasoning, category, confidence, status, timestamps, and presentation text.

3. **`index opportunity accept <id>`** — Accept an opportunity. Calls PATCH /api/opportunities/:id/status with { status: "accepted" }. Prints confirmation.

4. **`index opportunity reject <id>`** — Reject an opportunity. Calls PATCH /api/opportunities/:id/status with { status: "rejected" }. Prints confirmation.

Implementation touches:
- `args.parser.ts`: Add "opportunity" to KNOWN_COMMANDS, parse subcommands ("list", "show", "accept", "reject") and positional id arg. Add --status flag.
- `api.client.ts`: Add listOpportunities(opts), getOpportunity(id), updateOpportunityStatus(id, status) methods
- `main.ts`: Add "opportunity" case in switch, wire to handler functions
- `output.ts`: Add opportunityTable() and opportunityCard() renderers. Show valency roles (agent=Helper, patient=Seeker, peer=Peer) with color coding.
- New test file: `cli/tests/opportunity.command.test.ts`
- Update `cli/README.md` with opportunity command docs

API notes:
- GET /api/opportunities?status=pending&limit=10&offset=0 → { opportunities[] }
- GET /api/opportunities/:id → opportunity with presentation (reasoning, parties with roles, category, confidence)
- PATCH /api/opportunities/:id/status body: { status: "accepted"|"rejected" } → updated opportunity
- Statuses: latent, draft, pending, accepted, rejected, expired
