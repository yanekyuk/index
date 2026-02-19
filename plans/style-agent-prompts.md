# Style Agent Prompts — Plan (updated)

> **Status:** Agent introduction done in system prompt. General direction (voice/constraints) still to do.

## Done

### Agent introduction (system prompt)

- **File:** [protocol/src/lib/protocol/agents/chat.prompt.ts](protocol/src/lib/protocol/agents/chat.prompt.ts)
- Replaced the opening paragraph (“You are the AI assistant for Index Network…”) with the second-person role block:
  - **You are Index.** You help the right people find the user and help the user find them.
  - **Here’s what you can do:** Get to know the user, look for the right moments, learn about people, help the user stay connected (all phrased as “you” / “the user”).
  - **Closing:** Invite the user with a prompt like: What’s on your mind?
- No first message trigger, no frontend static intro block — the intro is entirely in the system prompt as instructions to the model.

---

## To do

### General direction (voice and constraints)

- **File:** [protocol/src/lib/protocol/agents/chat.prompt.ts](protocol/src/lib/protocol/agents/chat.prompt.ts)
- Add a **Voice and constraints** section (e.g. after the new “You are Index…” block, before “## Session” or in Behavioral Rules):
  - Not a search engine; no hype, corporate, or professional networking language; no pressure; no external actions without explicit approval.
  - Tone: Calm, direct, analytical, concise. No poetic language, no startup/networking clichés, no exaggeration.
  - Preferred words: opportunity, overlap, signal, pattern, emerging, relevant, adjacency.
  - Avoid: search, leverage, unlock, optimize, scale, disrupt, revolutionary, AI-powered, maximize value, act fast, networking, match.
  - For indexed data: say “looking up” (not “searching”).
- Merge or align with the existing “Avoid overusing the verb ‘search’…” line in Output Format so there is one consistent rule set.

### Optional

- **Placeholder:** Consider changing input placeholder from “What are you looking for?” to “What’s on your mind?” in [frontend/src/components/ChatContent.tsx](frontend/src/components/ChatContent.tsx) (e.g. via a shared constant).
- **Suggestion generator:** Add tone/word guidelines to [protocol/src/lib/protocol/agents/suggestion.generator.ts](protocol/src/lib/protocol/agents/suggestion.generator.ts) so follow-up chips stay on-brand.
