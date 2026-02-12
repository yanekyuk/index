# Chat Enhancement Plan

## Completed

1. **Intent creation triggers opportunity discovery**
	- "I am looking for RUST developers in brooklyn" -> results in find opportunities
	- It can both create an intent and find for opportunities (it can be both way)
	- Wording: do not mention "search." Instead tell that you will looking for it in the background.
	- Solution: `create_intent` auto-triggers discovery after creation; prompt enforces "intent first" flow.

2. **Human-friendly output**
	- Always answer human-friendly. Do not use variable names in backtick, or IDs.
	- Done: `CRITICAL OUTPUT RULES` section in shared prompt forbids variable names, backticks, raw JSON, and UUIDs.

3. **Clear error when no profile exists**
	- When there is no profile, attempting to create an intent, we get vague error (there was some error).
	- Done: Profile existence gate added in intent graph's `prepNode` before any create/update/delete operation.

4. **Opportunities require shared index**
	- Opportunities can happen if a member shares an index with another member. There is no difference between sharing 1 or 10 indexes.
	- Done: This is the structural reality of the system. Documented in the chat prompt.

5. **Stream format**
	- Stream should be: beginning_message + (tool + message)* + final_message
	- Done: Streaming refactored into `MetadataStreamer` / `ResponseStreamer` / `ChatStreamer`.

7. **Offer to persist intent after standalone discovery**
	- "Do you want me to keep looking for it" -> create intent if not created
	- Done: Prompt differentiates post-intent-creation (already saved, don't ask) vs post-standalone-discovery (offer to save).

8. **System should create intents first, not jump to discovery**
	- The system is not eager to create intents, it directly goes to list/create opportunities.
	- Done: Prompt now enforces "intent first" — `create_intent` must be called before `create_opportunities` when the user expresses a new need.

11. **No manual intent indexing**
	- Agent should never ask for intent indexing. Indexes are automatically indexed upon creation. (check update as well.)
	- Done: `create_intent` auto-assigns to the scoped index or auto-assign indexes. No prompt leads the agent to ask about indexing.

## Needs Work

10. **Conversation history in tools**
	- Make sure to send the conversation history to tools everytime.
	- Status: The LLM sees the full conversation history when deciding tool calls. However, tool *handler functions* themselves do not receive conversation history — they only get `ResolvedToolContext` (session identity) and `query` (LLM-decided args).
	- Decision needed: If the intent is "LLM should see history when calling tools" — already done. If tools themselves need message history as input, `defineTool` needs a signature change to pass `messages` to handlers.

14. **HyDE search for other people's intents**
	- Whenever looking for other people's intents, always use a hyde search to fetch n amount of them by similarity.
	- Status: Not started. `read_intents` does a flat DB read via the intent graph's `queryNode`. There is no similarity-based retrieval path for browsing others' intents.
	- Next step: Add a `search_intents` tool (or a `similaritySearch` mode on `read_intents`) that uses HyDE embeddings + pgvector to find semantically similar intents from other users in shared indexes. Can leverage the existing `hyde_documents` table.

15. **Opportunity reasoning field for LLM agents** (DONE)
	- The evaluator now generates a single `reasoning` field: a neutral, third-party analytical explanation of why the opportunity exists, mentioning both users by role. Written for other LLM agents to read and understand.
	- Old `sourceDescription`/`candidateDescription` fields removed; `interpretation.summary` replaced by `interpretation.reasoning` in the schema.
	- Person-facing descriptions are generated at display time by the chat agent.

---

## Linear (create via MCP or manually)

Create these three issues in your Linear project (e.g. with Linear MCP in Cursor — the agent session may not have MCP tools in scope):

| Title | Description |
|-------|-------------|
| **[Chat] Conversation history in tools** | Make sure to send the conversation history to tools every time. Status: LLM sees full history; tool handlers do not receive it. Decision: clarify if handlers need `messages`; if yes, change `defineTool` to pass `messages`. Ref: this plan §10. |
| **[Chat] HyDE search for other people's intents** | When looking for other people's intents, use HyDE similarity search. Next step: add `search_intents` (or `similaritySearch` on `read_intents`) using HyDE + pgvector; leverage `hyde_documents`. Ref: this plan §14. |
| **[Chat] Opportunity reasoning for LLM agents** | DONE. Evaluator now outputs `reasoning` (third-party, both-users, for LLMs). Schema `interpretation.reasoning` replaces `interpretation.summary`. Ref: this plan §15. |
