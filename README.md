# Index Network — Claude Code Plugin

Find the right people and let them find you. This plugin connects Claude Code to Index Network via MCP — managing signals, discovering opportunities, and connecting communities.

## Installation

Install the plugin in Claude Code. On first use, Claude Code will open a browser window to connect your Index Network account. No manual token setup required.

## What This Plugin Does

This plugin provides an **MCP server connection** and **skills** (behavioral guidance) that teach Claude how to use Index Network on your behalf.

- The MCP server at `https://protocol.index.network/mcp` exposes tools for reading and writing your profile, signals, networks, contacts, and opportunities
- Skills orchestrate those tools into natural conversation — you never see raw tool calls or IDs

### Skills

| Skill | Purpose |
|---|---|
| `index-network` | Core skill — MCP setup, context gathering, sub-skill dispatch |
| `index-network:onboard` | Guide new users through profile and first signal setup |
| `index-network:discover` | Find relevant people and opportunities |
| `index-network:signal` | Create and manage signals (what you're looking for or offering) |
| `index-network:connect` | Manage networks, contacts, and memberships |

## How It Works

1. Claude Code reads `.mcp.json` and registers the Index Network MCP server
2. On first connection, OAuth kicks in: browser opens, you log in, Claude Code stores the token automatically
3. When activated, the skill silently gathers your profile, signals, networks, and contacts for context
4. Based on your request, it invokes the appropriate sub-skill using MCP tools
5. Results are presented conversationally — no raw JSON, no internal IDs
