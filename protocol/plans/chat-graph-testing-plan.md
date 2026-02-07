# Chat Graph Manual Testing Checklist

Manual QA for the chat system: **graph**, **agent**, and **tools**. Use the frontend chat (or API); check off each item as you verify it.

**How to run:** Start protocol + frontend, open chat (user or index-scoped), send messages. Or call the chat API with `sessionId` / `indexId`.

**Suggested order (next steps):**
1. **§1.1 Basic flow** — "Hi", "What's my profile?", "Do I have any intents?", "Create an intent: I'm looking for a co-founder" (smoke test).
2. **§1.3 Streaming** — Confirm responses stream and no hang on "What are my intents?".
3. **§1.4 remaining** — In index chat: "Add an intent: Looking for a mentor in AI"; as owner: "Show all intents in this index".
4. **§3.5 Discovery** — "Find me opportunities" / "Who can help with fundraising?", then list_my_opportunities, then send_opportunity.
5. Then **§2** (agent iterations, no raw JSON, confirmation flow), **§3.1–3.4** (remaining tools), **§4** (edge cases).

---

## 1. Graph layer

### 1.1 Basic flow

- [x] Send "Hi" or "Hello" → agent replies with text only, no tool calls, no raw JSON
- [x] Ask "What's my profile?" or "Do I have any intents?" → agent calls tool(s), then replies with summary (no raw JSON)
- [x] Say "Create an intent: I'm looking for a co-founder" (with an index) → agent may call read_indexes then create_intent; reply confirms in plain language

### 1.2 Session context

- [ ] New chat, one message → reply is based only on that message
- [ ] Same chat, follow-up (e.g. "What did I just ask?" or "Add that to the AI index") → reply reflects prior messages
- [ ] Long conversation (20+ messages), ask about something earlier → reply coherent; recent context used (old messages may be truncated)

### 1.3 Streaming

- [x] Send any message → response streams incrementally in the UI
- [x] Ask "What are my intents?" → after tool execution, final reply streams; no crash or hang

### 1.4 Index-scoped chat

- [ ] Open chat from an index/community (index-scoped)
- [x] In index chat, ask "What are my intents here?" → agent lists intents in that index *(fixed: index-scoped read_intents now always uses session user)*
- [ ] In index chat, say "Add an intent: Looking for a mentor in AI" → intent created and linked to this index
- [ ] As index owner, ask "Show all intents in this index" or "everyone's intents" → agent returns all members' intents (no userId filter)

### 1.5 Error handling

- [ ] Trigger a failing path (e.g. delete profile and confirm, or invalid request) → agent returns clear error or fallback message, no uncaught exception in UI

---

## 2. Agent behavior

### 2.1 Iterations

- [ ] "Hi" or "What can you do?" → single round, reply only, no tool calls
- [ ] "Do I have a profile?" → agent calls read_user_profiles once, then replies
- [ ] "Show my profile and my intents and my indexes" → agent calls read_user_profiles, read_intents, read_indexes (order may vary), then one summarizing reply

### 2.2 Response format (no raw JSON)

- [ ] Any reply with data (intents, profile, opportunities) → no raw JSON in message (no `{ "classification": ... }`, no echoed tool JSON)
- [ ] Ask for intents, indexes, opportunities, or profile → data as natural language or Markdown tables; no ID columns; dates human-readable; "Draft" for latent opportunities

### 2.3 Confirmation flow

- [ ] Have an intent, say "Change my intent [X] to: [new description]" → agent asks for confirmation before updating
- [ ] Reply "Yes" or "Confirm" to that → agent runs confirm_action, reports success, intent updated in DB
- [ ] Start another update, then say "No" or "Cancel" → agent cancels; no change applied
- [ ] "Delete my intent [X]" → agent asks to confirm; then confirm or cancel works as expected

### 2.4 Iteration limits (optional)

- [ ] Force many tool calls in one conversation → agent eventually wraps up (soft nudge) or is forced to respond (hard limit); no infinite loop

---

## 3. Tools (trigger via natural language)

### 3.1 Profile

- [ ] **read_user_profiles**: "Do I have a profile?" / "What's my profile?" → reply says no profile or shows name/bio/skills/interests (no raw JSON)
- [ ] **create_user_profile**: "Create my profile. I'm Jane, a developer in NYC, skills: TypeScript." (no profile) → profile created, reply confirms
- [ ] **create_user_profile from URL**: "Create my profile from https://linkedin.com/in/..." (no profile) → scrape_url then create_user_profile; reply confirms
- [ ] **update_user_profile**: "Update my profile: add Python to skills." (has profile) → profile updated, reply confirms
- [ ] **update_user_profile from URL**: "Update my profile from https://github.com/..." (has profile) → scrape then update; reply confirms

### 3.2 Intent

- [ ] **read_intents**: "What are my intents?" → list in plain language or table; no IDs in reply
- [x] **read_intents in index**: In index chat "My intents here" / "All intents in this index" (owner) → correct scope (yours vs everyone's)
- [ ] **create_intent**: "Add an intent: Looking for a React dev" → intent created; appears in read_intents
- [ ] **create_intent from URL**: "Create an intent from https://github.com/foo/bar" → scrape_url then create_intent; intent from content, not raw URL
- [ ] **update_intent**: "Change my intent [describe which] to: ..." → asks to confirm; after confirm, intent updated
- [ ] **delete_intent**: "Delete my intent [describe which]" → asks to confirm; after confirm, intent removed

### 3.3 Intent–Index

- [ ] **create_intent_index**: "Add my intent [X] to the AI index" → intent appears in that index
- [ ] **read_intent_indexes**: "Which indexes is my intent [X] in?" or "List intents in this index" → correct list; names/descriptions shown
- [ ] **delete_intent_index**: "Remove my intent [X] from the AI index" → intent no longer in that index (intent still exists)

### 3.4 Index

- [ ] **read_indexes**: "What indexes am I in?" / "My communities" → list of indexes (titles, etc.); no raw IDs
- [ ] **read_users**: "Who is in the [index name]?" → list of members (names, etc.)
- [ ] **create_index**: "Create an index called AI Founders" → index created; you are owner
- [ ] **update_index**: "Change the AI index title to AI & ML Founders" (as owner) → update_index then confirm; index updated
- [ ] **delete_index**: "Delete the [index] index" (sole member) → delete_index then confirm; index deleted
- [ ] **create_index_membership**: As owner, "Add [user] to the AI index" → user added to index

### 3.5 Discovery (opportunity)

- [ ] **create_opportunities**: "Find me opportunities" / "Who can help with fundraising?" (with indexed intents) → reply says how many drafts; suggests "send intro to [name]" when ready
- [ ] **list_my_opportunities**: "What opportunities do I have?" → list of opportunities (Draft/pending, etc.) in table or plain language
- [ ] **send_opportunity**: "Send intro to [name]" (after create_opportunities) → opportunity moves to pending; other party notified if wired

**Two-user scenario (opportunities only match within the same index):**

| Step | Who | Action |
|------|-----|--------|
| 1 | **User A** | Create or join an index (e.g. "Open Mock Network"). Create an intent in that index, e.g. "Looking for a technical co-founder for my AI startup." |
| 2 | **User B** | Log in as a different user (different browser/incognito or another account). Join the **same** index. Create an intent in that index, e.g. "Looking to join an early-stage startup as technical co-founder" or "Seeking co-founder role in AI/ML." |
| 3 | **User A** | In chat (user or index-scoped): "Find me opportunities" or "Who can help with a technical co-founder?" |
| 4 | **User A** | Reply should report draft(s). Ask "What opportunities do I have?" → list shows Draft(s) with the other person’s name. |
| 5 | **User A** | "Send intro to [B’s name]" → opportunity moves to pending; B is notified (if notifications are wired). |
| 6 | **User B** | (Optional) List or view opportunities to see the pending intro from A. |

**Requirements:** Same index, both users have intents in that index (HyDE is generated automatically). Profiles improve matching but are not strictly required.

### 3.6 Utility and confirmation

- [ ] **scrape_url**: Prompt with a URL (profile, intent, or "what's on this page?") → agent uses page content in reply or create/update
- [ ] **confirm_action**: After "Do you want to update/delete X?" say "Yes" → action executed; success message
- [ ] **cancel_action**: After confirmation prompt, say "No" / "Cancel" → no change; confirmation cleared

---

## 4. Edge cases

- [ ] No profile, ask "Update my profile" → agent says you have no profile or suggests creating one
- [ ] Already have profile, say "Create my profile" → agent says you already have one, use update instead
- [ ] Update/delete intent that doesn't exist or wasn't just referenced → clear error or "intent not found"
- [ ] As non-owner, ask to change index title → agent explains owner-only or returns error
- [ ] "Find opportunities" with no intents in any index → agent explains need to join an index and add intents first
- [ ] Start update/delete, wait 5+ minutes, then say "Yes" → agent says confirmation expired or asks to repeat

---

## Summary

- [ ] **Graph**: Basic flow, session context, streaming, index-scoped chat, error handling
- [ ] **Agent**: Iterations, no raw JSON, tables/formatting, confirmation flow
- [ ] **Tools**: All 22 tools triggered at least once with expected outcome
- [ ] **Edge cases**: No profile, already profile, wrong id, not owner, no indexed intents, expired confirmation
