---
trigger: "Standardize introducer opportunity visualization: same component in chat and home, use arrow style, clickable names to profiles, show all user avatars"
type: refactor
branch: refactor/introducer-card-unified
base-branch: dev
created: 2026-03-29
version-bump: patch
linear-issue: IND-120
---

## Related Files
- frontend/src/components/chat/OpportunityCardInChat.tsx (shared OpportunityCard component — main target)
- frontend/src/components/ChatContent.tsx (uses OpportunityCard in both home view and chat message rendering)
- frontend/src/components/UserAvatar.tsx (avatar component)
- frontend/src/services/opportunities.ts (HomeViewCardItem type, OpportunityCardData interface)
- protocol/src/lib/protocol/tools/opportunity.tools.ts (generates headline with arrow format: "Alice → Bob")
- protocol/src/lib/protocol/agents/opportunity.presenter.ts (generates card text for home view)

## Relevant Docs
- docs/domain/feed-and-maintenance.md
- docs/domain/opportunities.md

## Related Issues
- IND-120 Introducer opportunity card UI should match the one in the profile page (Triage)
- IND-140 Introducer flow creates opportunities for self instead of connection cards (Done)
- IND-124 Implement live opportunity data for "You're the connector" section on profile page (Backlog)

## Scope

### Problem
The introducer opportunity card currently has two different visual treatments:
1. In chat: when `viewerRole === "introducer"`, the headline shows "Alice → Bob" (arrow format) but the card still uses a single-avatar layout with the counterpart name
2. In home: same component is used but the narrator chip (bottom of card) shows the introducer with a text remark — a different visual pattern

### Changes needed

1. **Unified introducer card layout**: When the viewer is the introducer, the card header should show both parties with their avatars and an arrow between them (e.g. `[Avatar] Alice → [Avatar] Bob`), replacing the current single-avatar + headline approach.

2. **Clickable names**: All user names in the card (both parties and narrator/introducer) should be clickable and navigate to `/u/{userId}`. The counterpart name click already works — extend to the second party name and ensure narrator chip name is also linked.

3. **All avatars visible**: Show avatars for all users involved — both parties in the header and the introducer in the narrator chip. Currently the narrator chip already shows an avatar, but the second party in the arrow headline has no avatar.

4. **Single component**: Both chat and home already use `OpportunityCard` from `OpportunityCardInChat.tsx`. The refactor should enhance this single component to handle the introducer layout properly, not create a second component.

### Data requirements
The `OpportunityCardData` interface may need a `secondParty` field (name, avatar, userId) to render the arrow layout with both avatars. Check if the protocol already provides this data in the card payload or if it needs to be added to the presenter/tools output.
