# Agents Page Merge Design

## Problem

The sidebar dropdown has three separate entries — Agent, Agents, Settings — that should be consolidated into one. The current `/agent` page shows negotiation insights, `/agents` shows the agent list, and `/settings` shows API keys with MCP setup instructions. Users must navigate between all three to manage agents and their keys.

## Design

### Sidebar Dropdown

**Remove**: Agent (Bot icon → `/agent`), Agents (KeyRound icon → `/agents`), Settings (Settings icon → `/settings`).

**Add**: Single "Agents" entry with `Bot` icon, navigating to `/agents`.

Final dropdown order: Networks, Library, Profile, Agents, then Logout separator.

### `/agents` Page — Agent List (minor update)

Structure unchanged (system agents section, personal agents section, register button). Each agent card becomes a clickable link navigating to `/agents/:id`.

### `/agents/:id` — Agent Detail Page (new)

A dedicated page scoped to a single agent, with tabs:

1. **Overview** — For the Chat Orchestrator system agent (`00000000-0000-0000-0000-000000000001`), this tab contains the negotiation insights content (stats, role distribution, top counterparties, summary) and negotiation history currently on `/agent`. For all other agents, a minimal overview showing name, type badge, status badge, and description.

2. **API Keys** — The key management UI from the current `/agents` page, scoped to this single agent. Includes the `SetupInstructions` component (Claude Code and Hermes YAML config snippets with the agent's key) currently in `/settings/api-keys.tsx`.

3. **Permissions** — Read-only view of the agent's permission badges (deduplicated actions across all permission rows).

### `/agent` Route — Removed

Route and page file deleted. Sidebar entry removed. Negotiation insights content moves into the Chat Orchestrator's detail page Overview tab.

### `/settings` Route — Removed

Route and page files deleted. Sidebar entry removed. API key management and setup instructions move into agent detail pages.

## Routing Changes

| Route | Before | After |
|-------|--------|-------|
| `/agents` | Agent list page | Agent list page (cards now link to `/agents/:id`) |
| `/agents/:id` | Did not exist | Agent detail page (new) |
| `/agent/:tab?` | Negotiation insights | Removed — redirects to `/agents` |
| `/settings` | API keys + setup instructions | Removed — redirects to `/agents` |

## Files to Create

- `frontend/src/app/agents/[id]/page.tsx` — Agent detail page with Overview, API Keys, Permissions tabs

## Files to Modify

- `frontend/src/components/Sidebar.tsx` — Remove Agent, Agents, Settings entries; add single Agents entry; remove unused imports (`Settings`, `KeyRound`); update active-route detection
- `frontend/src/app/agents/page.tsx` — Make agent cards clickable links to `/agents/:id`
- `frontend/src/routes.tsx` — Add `/agents/:id` route; remove `/agent/:tab?` and `/settings` routes; add redirects from `/agent` → `/agents` and `/settings` → `/agents`
- `frontend/src/components/ClientWrapper.tsx` — Add `/agents/:id` to app routes if needed

## Files to Delete

- `frontend/src/app/agent/page.tsx` — Negotiation insights moved to agent detail Overview tab
- `frontend/src/app/settings/page.tsx` — Content moved to agent detail API Keys tab
- `frontend/src/app/settings/api-keys.tsx` — Setup instructions extracted for reuse in agent detail

## Components to Extract/Reuse

- `SetupInstructions` from `settings/api-keys.tsx` — Extract to a shared component or inline into the agent detail API Keys tab
- `NegotiationHistory` from `components/NegotiationHistory.tsx` — Already shared, reuse in agent detail Overview tab
- `OverviewTab` from `agent/page.tsx` — Extract and reuse for Chat Orchestrator's detail page

## Data Flow

- Agent detail page loads agent by ID via `agentsService.get(id)`
- Overview tab for Chat Orchestrator loads negotiation insights via `usersService.getNegotiationInsights(userId)`
- API Keys tab loads agent-linked keys via `agentsService.createToken` / `agentsService.revokeToken`
- Permissions tab reads from `agent.permissions` (already in the agent response)