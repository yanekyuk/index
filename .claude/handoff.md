---
trigger: "Bug: Introducer opportunity card shows repeated/concatenated names in header. Screenshot shows 'Seref Yarar ↔ Seref Yarar ↔ Seref Yarar ↔ jiawei ↔ jiawei ↔ jiawei → jiawei' instead of clean 'Seref Yarar → jiawei' dual-avatar layout."
type: fix
branch: fix/introducer-card-names
base-branch: dev
created: 2026-03-29
version-bump: patch
---

## Related Files
- protocol/src/lib/protocol/graphs/home.graph.ts (lines ~314-322, generateCardTextNode — duplicate actor mapping)
- frontend/src/components/chat/OpportunityCardInChat.tsx (card component, renders name field)
- protocol/src/types/chat-streaming.types.ts (OpportunityCardPayload type)
- protocol/src/lib/protocol/states/home.state.ts (HomeCardItem type)

## Relevant Docs
- docs/specs/introducer-discovery.md
- docs/domain/opportunities.md
- docs/domain/feed-and-maintenance.md

## Related Issues
- IND-120 Introducer opportunity card UI should match the one in the profile page (Done) — the refactor that introduced this code

## Scope
In `generateCardTextNode` in `home.graph.ts`, the `introducerCounterparts` array can contain multiple actor rows for the same userId. When these are mapped to names and joined with " ↔ ", duplicates appear (e.g. "Seref Yarar ↔ Seref Yarar ↔ Seref Yarar ↔ jiawei ↔ jiawei ↔ jiawei").

Fix: deduplicate `introducerCounterparts` by `userId` before mapping to names. Change the participantNames construction (lines ~317-319) to first extract unique userIds, then map each to a name.
