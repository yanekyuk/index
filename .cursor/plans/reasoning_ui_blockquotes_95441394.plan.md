---
name: Reasoning UI Blockquotes
overview: Update the chat agent's system prompt to make tool narration smarter - grouping related tools under semantic blockquotes and hiding prerequisite operations. This is a prompt-only change with no backend or frontend code modifications.
todos:
  - id: update-prompt
    content: Update narration instructions in chat.prompt.ts with semantic grouping rules
    status: done
  - id: test-scenarios
    content: "Test: connect users, find opportunities, look up person - verify blockquote behavior"
    status: pending
isProject: false
---

# Reasoning UI - Semantic Tool Narration

## Summary

Update `chat.prompt.ts` to teach the LLM to:

1. Group related tools under one semantic blockquote
2. Hide prerequisite operations (membership checks, permission verification)
3. Use context-specific language ("Looking up Seren Sandikci" not "reading profiles")

**Scope**: Prompt engineering only. No backend/frontend code changes.

---

## Problem

Currently, when the agent needs to connect two users, it narrates each tool individually:

```
> Checking your membership...
> Checking their membership...
> Looking up your profile...
> Looking up their profile...
```

This exposes implementation details and creates noise.

---

## Solution

Update the narration instructions in `[protocol/src/lib/protocol/agents/chat.prompt.ts](protocol/src/lib/protocol/agents/chat.prompt.ts)` to guide the LLM toward semantic grouping.

### Current Prompt Section (lines ~283-309)

```markdown
### Narration Style
...
**One tool at a time (only when needed).**
```

### New Prompt Section

```markdown
### Narration Style

Your response is **streamed to the user token-by-token in real-time**.

**Semantic grouping**: When calling multiple related tools, write ONE blockquote describing the overall action, then call all tools together. Don't narrate each tool separately.

**Hide prerequisites**: Permission checks, membership verification, and similar background operations should not be narrated. Group them with the main action silently.

**Context-specific labels**: Use names and context from the conversation.
- Good: "Looking up Seren Sandikci"
- Bad: "Reading user profiles"

**Examples**:

Connecting two people (involves 4+ tools):
```

> Looking up Alice and Bob

```
(Silently executes: 2 membership checks + 2 profile reads)

Finding opportunities (involves search + evaluation):
```

> Finding people who match your interests

```

Checking a specific person:
```

> Looking up Seren Sandikci

```

**When NOT to narrate**:
- Prerequisite checks (membership, permissions)
- Internal state lookups
- Validation operations
```

---

## Files to Modify


| File                                                                | Change                                            |
| ------------------------------------------------------------------- | ------------------------------------------------- |
| `[chat.prompt.ts](protocol/src/lib/protocol/agents/chat.prompt.ts)` | Update "Narration Style" section (~lines 283-330) |


---

## Testing

After updating the prompt, test these scenarios:

1. **Connect two users**: Should show one blockquote like "Looking up Alice and Bob"
2. **Find opportunities**: Should show semantic step like "Finding matches"
3. **Look up specific person**: Should use their name in the blockquote

---

## Out of Scope

Per user clarification, these are NOT included:

- Behavior changes (e.g., what to do when no investors found)
- ThinkingDropdown UI changes
- Backend event emission changes
- Any functionality modifications

