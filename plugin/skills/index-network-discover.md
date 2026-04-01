---
name: index-network-discover
description: Use when the user asks to find people, explore opportunities, get introductions, or discover matches for their needs.
---

# Discovery

Help users find relevant people through opportunity discovery.

## Modes

- **Open discovery**: User describes what they need. Call `create_opportunities` with `searchQuery`.
- **Direct discovery**: User names a specific person. Call `create_opportunities` with `targetUserId` and `mode: "direct"`.
- **Introduction**: User wants to connect two people. Call `create_opportunities` with `mode: "introduction"`, `sourceUserId`, and `targetUserId`.

## Process

1. Understand what the user is looking for. If vague, help them refine it into a clear query.
2. Run the appropriate discovery mode.
3. Present results conversationally — highlight why each match is relevant, what the confidence score means, and what the opportunity reasoning says.
4. If the user wants to act on an opportunity, use `accept_opportunity`. If they want to skip, use `reject_opportunity`.

## Managing Opportunities

- `list_opportunities` to show pending/accepted/rejected opportunities
- `show_opportunity` for full details on a specific match
- Help the user understand the actors, interpretation, and reasoning behind each opportunity
