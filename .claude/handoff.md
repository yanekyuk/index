---
trigger: "Introducer cards in home feed show redundant names like 'Mert Karadayi ↔ Yanki Ekin Yuksel → Mert Karadayi' because card.name uses joined format while secondParty is also populated. Also, introducer should not see themselves listed as a connection opportunity."
type: fix
branch: fix/introducer-card-name-format
base-branch: dev
created: 2026-03-29
version-bump: patch
---

## Related Files
- protocol/src/lib/protocol/graphs/home.graph.ts (lines 326-328 — userName set to participantNames.join(' ↔ ') for introducers; lines 346-357 — secondPartyData also built; lines 360-363 — fallbackCard uses userName)
- protocol/src/lib/protocol/support/opportunity.utils.ts (lines 74-94 — canUserSeeOpportunity; lines 101-130 — isActionableForViewer)
- frontend/src/components/chat/OpportunityCardInChat.tsx (lines 252, 283-346 — dual-avatar arrow layout renders card.name → secondParty.name)

## Relevant Docs
- docs/domain/opportunities.md
- docs/domain/feed-and-maintenance.md
- docs/specs/introducer-discovery.md

## Related Issues
- None

## Scope
Two fixes needed:

### Fix 1: Redundant name display in introducer cards
In `home.graph.ts` line 327-328, `userName` is set to `participantNames.join(' ↔ ')` for introducer cards. But `secondPartyData` (lines 346-357) is also populated. The frontend's dual-avatar arrow layout renders `card.name → secondParty.name`, producing:
- "Mert Karadayi ↔ Yanki Ekin Yuksel → Mert Karadayi" (redundant)

When `secondPartyData` is present, `userName` should be just the single display counterpart name (otherUser?.name), not the "↔" joined format. The arrow layout in the frontend handles showing both names via card.name and card.secondParty.

### Fix 2: Introducer should not see themselves as a connection
The narrator chip shows "You: You've curated this connection for Yankı" which is correct for introducer view, but the introducer should not appear to themselves as a regular connection opportunity card in their feed. If the user is the introducer on an opportunity, the card should only appear as a connector-flow card (which it does via classifyOpportunity), but they should NOT also see themselves listed as a separate connection opportunity for the same underlying match. Check if isActionableForViewer or canUserSeeOpportunity allows duplicate visibility where the user appears both as introducer AND as a party on related opportunities.

### Fix 3: Introducer cards must always appear AFTER normal connections
The `selectByComposition` in `opportunity.utils.ts` already merges in category priority order (connection > connector-flow > expired), but the final output sometimes shows introducer cards above or mixed with normal connection cards. Verify that the ordering is enforced end-to-end through the normalizeAndSort step in `home.graph.ts` — the LLM categorizer may be placing connector-flow cards into sections that appear before connection sections. Ensure connector-flow cards always render below normal connections in the final feed.
