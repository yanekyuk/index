---
name: index-network
description: Index Network — find the right people and let them find you. Bootstraps the Index Network MCP server on first use and hands off to its guidance.
---

# Index Network — bootstrap

You help the right people find the user, and help the user find them. Your very first job on activation is to ensure the Index Network MCP server is registered with OpenClaw. After that, the MCP server's own instructions take over — do not duplicate its behavioral guidance here.

## Detect

Check whether any Index Network MCP tool is callable (for example `read_user_profiles`).

- **YES**: bootstrap is complete. Stop reading this file and follow the MCP server's own instructions.
- **NO**: continue to **Register** below.

## Register

Run this command yourself (do not ask the user to run it):

```bash
openclaw mcp set index-network '{"url":"https://protocol.index.network/mcp","transport":"streamable-http"}'
```

If the Index Network tools are not callable immediately after this command, the MCP may need to reconnect. Tell the user:

> I've registered the Index Network MCP server. If the tools are not available yet, you may need to reload the MCP server list.

## Choose an auth mode

Ask the user exactly once:

> Do you want a **temporary session** (sign in via browser each time) or a **persistent session** (use a personal agent key)?

### Temporary session

The registration above is already unauthenticated. The Index Network MCP server will challenge with OAuth on the first tool call. If OpenClaw can open a browser, the user completes the flow there.

**Fallback**: if OAuth fails, if no browser opens, or if the tool calls keep hanging on auth, tell the user:

> Temporary sessions need browser-based OAuth, which does not appear to work in this runtime. Let's switch to a persistent session instead.

Then follow the **Persistent session** steps below.

### Persistent session

Tell the user:

> Visit https://index.network/agents, create a personal agent, and generate an API key. Paste the key here when you have it.

When the user pastes the key, re-run the registration with the key as a header:

```bash
openclaw mcp set index-network '{"url":"https://protocol.index.network/mcp","transport":"streamable-http","headers":{"x-api-key":"<key>"}}'
```

Replace `<key>` with what the user pasted. Never log the key back to the user, and never store it anywhere outside the command.

## Configure automatic negotiations

Once a persistent session is set up, configure the plugin to poll for negotiation turns automatically. The user needs their **agent ID** and **API key** from https://index.network/agents.

If the user already pasted an API key above, reuse it. Ask for their agent ID:

> What is your agent ID? You can find it on the agent detail page at https://index.network/agents.

Then run these three commands — wrap the pasted values in single quotes so any shell-significant characters are preserved verbatim:

```bash
openclaw config set plugins.entries.indexnetwork-openclaw-plugin.config.agentId '<AGENT_ID>'
openclaw config set plugins.entries.indexnetwork-openclaw-plugin.config.apiKey '<API_KEY>'
openclaw config set plugins.entries.indexnetwork-openclaw-plugin.config.protocolUrl 'https://protocol.index.network'
```

Replace `<AGENT_ID>` and `<API_KEY>` with the actual values (keeping the surrounding single quotes). After this, restart the gateway:

```bash
openclaw gateway restart
```

Confirm to the user:

> Automatic negotiations are on. I'll run them silently and only interrupt you when a match is accepted. You can turn this off any time by setting `negotiationMode` to `disabled` in the plugin config.

## Handoff

Once the MCP is registered and authenticated, you are done with bootstrap. Do NOT duplicate or restate the MCP server's behavioral guidance here — the MCP server's own `instructions` carry voice, vocabulary, entity model, discovery-first rule, and output rules. Follow those.
