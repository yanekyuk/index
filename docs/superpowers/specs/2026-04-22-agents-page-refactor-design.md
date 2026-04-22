# Agents Page Refactor — Design Spec

**Date:** 2026-04-22

## Overview

Refactor the `/agents` frontend page to reduce repetition of setup instructions and improve the first-time agent setup experience with a focused modal for newly created API keys.

## Changes

### 1. Remove per-agent `SetupInstructions`

The existing `SetupInstructions` collapsible is rendered inside every personal agent card. It is removed entirely from individual cards.

### 2. Agent ID visible in each personal agent card

Each personal agent card gains an **Agent ID row** below the agent name:

- Label: `Agent ID`
- Value: the agent's UUID, displayed in a monospace code chip
- A **Copy** button to the right copies the ID to clipboard

This replaces the need to go into the agent detail page to find the ID.

### 3. Page-level Setup Instructions section

A single **Setup Instructions** section is added at the bottom of the page, below the Personal Agents section, separated by a divider.

- **Expanded by default** (no collapse toggle)
- Uses **placeholder values** (`YOUR_API_KEY`, `YOUR_AGENT_ID`) since it is not scoped to a specific agent
- Introductory text: "Connect a personal agent to Index Network using any platform below. Copy your Agent ID from the card above, then generate and copy an API key."

Platforms covered (same as today):

**Claude Code / OpenCode** — full JSON config block, clickable to copy entire block.

**Hermes Agent** — YAML config block, clickable to copy entire block.

**OpenClaw** — two commands shown in a tree layout:
- `Install (first time)` → `openclaw plugins install indexnetwork-openclaw-plugin --marketplace https://github.com/indexnetwork/openclaw-plugin`
- `Update (if already installed)` → `openclaw plugins update indexnetwork-openclaw-plugin`

Then a `Run setup wizard` step: `openclaw index-network setup`

Followed by a **wizard reference grid** (see §4 below, but with `YOUR_AGENT_ID` / `YOUR_API_KEY` placeholders instead of real values).

All code blocks are **full-width clickable copy buttons**: clicking anywhere on the block copies its content; green hover tint + "✓ Copied" feedback.

### 4. New API Key modal

When the user clicks **Generate Key** on any personal agent card, a **modal dialog** opens instead of the existing inline amber banner.

**Modal title:** "API Key Created" / subtitle: "For: {agent name}"

**Section 1 — Key display (amber):**
- Warning: "Copy this key now — it won't be shown again"
- Full key in a monospace code box with a **Copy** button

**Section 2 — Setup Instructions (personalized):**
- Intro: "Your Agent ID and API key are pre-filled below. Pick the platform you use."
- Same three platform blocks as the page-level section, but with **real values** substituted:
  - API key: the newly created key
  - Agent ID: the agent's actual UUID
- Real values highlighted in green to distinguish from static text

**OpenClaw wizard reference grid:**

A two-column CSS grid (50/50) listing all wizard prompts. The left column shows the prompt name + a small description beneath it. The right column is a full-height code-block-styled cell.

| Prompt | Value |
|--------|-------|
| Server URL | `https://api.index.network` *(clickable copy)* |
| Agent ID | `{real agent UUID}` *(clickable copy)* |
| API Key | `{real api key}` *(clickable copy)* |
| *(Optional section header)* | |
| Delivery channel | `select or skip` *(static)* |
| Delivery target | `your ID` *(static)* |
| Daily digest | `enable / disable` *(static)* |
| Digest time | `08:00 (default)` *(static)* |
| Max per digest | `10 (default)` *(static)* |

The first three rows (required values) are **full-height clickable copy buttons** — hover shows green tint, click copies the value, feedback shows "✓ Copied". The optional rows are static display only.

**Modal footer:** Single **Done** button closes the modal.

The existing inline amber banner (currently shown inside the agent card after key creation) is removed — the modal replaces it entirely.

**Implementation:** Use `@radix-ui/react-dialog` (already a dependency, used in `[id]/page.tsx`). The modal opens when `newlyCreatedKey` state is set; closing it (Done button or overlay click) clears that state.

## Interaction Details

### Clickable code blocks

All code blocks (both in the page-level section and the modal) use this pattern:
- `<button>` wrapping the content + a `⧉ Copy` hint pinned to the right
- `white-space: pre-wrap` to preserve indentation/newlines
- `word-break: break-all` so long URLs still wrap
- Green hover tint (`#f0fdf4` background, `#86efac` border)
- On click: copy to clipboard, swap hint to "✓ Copied" for 1.5s

### System agents

Both system agents are shown in the System Agents section:
- Index Chat Orchestrator
- Index Negotiator

No changes to system agent card structure.

## Files Affected

- `frontend/src/app/agents/page.tsx` — primary change: remove per-agent `SetupInstructions`, add Agent ID row, add page-level section, replace inline amber banner with modal trigger
- `frontend/src/app/agents/[id]/page.tsx` — apply same clickable code block pattern and install+update tree to the SetupInstructions component there for consistency
