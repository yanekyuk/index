# Agent Negotiation Framing

**Date:** 2026-04-27

## Problem

When opportunities surface in the user's chat (Telegram, etc.), nothing in the OpenClaw main-agent prompt tells the agent to acknowledge that these results came from background agent-to-agent negotiation. The user sees "Seren looks relevant…" with no signal that their Index agent has been working in the background on their behalf. That context is what makes the discovery feel earned rather than algorithmic — and it's currently missing.

## Scope

OpenClaw plugin only. No changes to MCP / `opportunity.tools.ts` — ambient and daily digest are OpenClaw delivery concepts, not MCP-surface concepts, and a generic MCP tool response shouldn't carry an "agent negotiated in the background" narrative for clients that don't have that flow.

## Changes

**File:** `packages/openclaw-plugin/src/lib/delivery/main-agent.prompt.ts`

Edit `perTypeInstruction()` (lines 114-148) to add framing instructions to two of the three opportunity types it handles.

### `ambient_discovery` (lines 127-144)

Append an instruction telling the agent to open with one short line that frames the candidate as the result of background negotiation between its agent and other people's agents, before presenting the opportunity itself. The agent still speaks in its own voice; the framing is delivered as instruction, not template.

Reference phrasing (an anchor for the agent, not a fixed string):

> *"Your Index agent has been quietly negotiating with other agents — here's a new possibility worth surfacing."*

### `daily_digest` (lines 117-126)

Same shape, framed as a summary rather than a single surfaced candidate. The pass already explains that ambient ran earlier today; the framing addition tells the agent to open with one line acknowledging the broader background work, then present the numbered list.

Reference phrasing:

> *"Here's what your Index agent has been working on in the background — a summary of recent negotiations."*

### `test_message` (lines 145-146) — explicitly excluded

Leave untouched. This is a delivery-verification probe, not a real opportunity, and framing it as the result of negotiation would be misleading.

## Voice constraints

The reference phrasings above match the project voice (calm, direct, analytical, concise). The implementing prompt should not introduce banned vocabulary (`leverage`, `unlock`, `optimize`, `scale`, `maximize`, `match`, etc.) or describe the action as "search". Prefer language like *signal, surfaced, emerging, adjacency, negotiation*.

## Out of scope

- `packages/protocol/src/opportunity/opportunity.tools.ts` — unchanged.
- `buildOpportunityPresentation()` and its MCP path — unchanged. Any MCP client (Claude Code, custom agents) calls it as a generic discovery tool; ambient/digest framing doesn't apply there.
- The web-chat opportunity card UI — unchanged.
- The negotiation subagent itself — unchanged. Per project convention, behavioral guidance for the negotiator lives in the MCP server's `MCP_INSTRUCTIONS`, not the OpenClaw delivery prompt.

## Files to change

- `packages/openclaw-plugin/src/lib/delivery/main-agent.prompt.ts` — `perTypeInstruction()`, the `daily_digest` and `ambient_discovery` cases only.
