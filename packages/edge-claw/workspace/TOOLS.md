# TOOLS.md — Local Notes

## Index Network MCP

The MCP server `index` is your primary tool surface — every capability you have on the network is a tool call there. You do not call HTTP endpoints directly; you do not poll. The gateway wires the MCP, and you talk to it.

Endpoint (registered during `BOOTSTRAP.md`):

- URL: `${INDEX_URL}/mcp` (default `https://index.network/mcp`, taken from the `INDEX_URL` environment variable)
- Transport: `streamable-http`
- Auth: `x-api-key` header, value from the `INDEX_API_KEY` environment variable

### Tool families

- **Profile** — `create_user_profile`, `read_user_profiles`, `update_user_profile`
- **Networks (communities)** — `read_networks`, `create_network`, `update_network`, `delete_network`, `read_network_memberships`, `create_network_membership`, `delete_network_membership`
- **Signals (intents)** — `create_intent`, `read_intents`, `update_intent`, `delete_intent`, `search_intents`, `create_intent_index`, `read_intent_indexes`, `delete_intent_index`
- **Discovery** — `create_opportunities`, `list_opportunities`, `update_opportunity`, `confirm_opportunity_delivery`
- **Negotiations** — `list_negotiations`, `get_negotiation` (read-only — negotiations are handled server-side; do not call `respond_to_negotiation`)
- **Conversations** — `list_conversations`, `get_conversation`
- **Contacts** — `add_contact`, `import_contacts`, `import_gmail_contacts`, `list_contacts`, `search_contacts`, `remove_contact`
- **Agents (administrative)** — `list_agents`, `register_agent`, `update_agent`, `delete_agent`, `grant_agent_permission`, `revoke_agent_permission`
- **Onboarding** — `complete_onboarding`
- **Reference** — `read_docs`, `scrape_url`

Read the description on every tool you call — that is where the per-tool rules live (when to call, when NOT to call, prerequisites, post-call follow-ups).

### Output translation

The MCP returns structured records. You do not pass them through. Translate before speaking:

| Internal | What the user hears |
|---|---|
| `intent` | "signal" |
| `index` / `network` | "community" |
| `Membership.isPersonal=true` | "their personal network" — usually unmentioned |
| status `draft` / `latent` | "draft" |
| status `pending` | "sent" |
| status `accepted` | "connected" |

Never expose internal IDs unless the ID is actionable (e.g. a `conversationId` the user can open).

## Local files

- `memory/heartbeat-state.json` — last-run timestamps for heartbeat tasks (so intervals survive restarts) and dedup hashes (e.g. `lastAmbientHash`).
- `memory/YYYY-MM-DD.md` — daily memory log.
- `MEMORY.md` — curated long-term memory; **main session only**.

## Channel formatting

- **Discord / WhatsApp:** no markdown tables; use bullet lists.
- **Discord:** wrap multiple links in `<>` to suppress embeds: `<https://example.com>`.
- **WhatsApp:** no headers — use **bold** or CAPS for emphasis.
- **Telegram:** Markdown rendering is on; the deep-link format `https://t.me/{handle}?text={uri-encoded-message}` pre-fills a draft when the user clicks.

## URL preservation

For any opportunity you surface, weave its URLs into the flow of your prose. The links must be **secondary** to the prose: a reader should be able to strip every URL and still have a coherent sentence about the person. If the visible text is just link labels glued together with punctuation, you have already lost.

Do **not** render links as a separate "buttons" line, a bullet list of links, a pipe-separated row, a markdown table, a blockquote whose body is link labels, or a short standalone paragraph whose only content is link labels. These all read as a UI control strip in chat.

- Link the person's name to their `profileUrl` the first time you mention them.
- Embed `acceptUrl` on a short verb phrase inside a sentence (e.g. "message Alex", "make intro", "reach out to them").
- The URL strings themselves must appear verbatim — do not edit, shorten, proxy, or drop them. Anchor text is up to you.
- If you decide not to mention an opportunity, leave it out — do not output its data without an inline action link.
