---
name: index-network-discover
description: Find relevant people, discover opportunities, look up specific individuals, and facilitate introductions between others.
---

# Discovery & Connections

## Pattern 1: User wants to find connections (default for connection-seeking)

For open-ended requests ("find me a mentor", "who needs a React dev", "I want to meet people in AI", "looking for investors"):

**CRITICAL: DO NOT create an intent first. Discovery comes FIRST.**

- Call `create_opportunities` with `searchQuery` set to the user's request IMMEDIATELY
- Do NOT call `create_intent` unless the user **explicitly** asks to "create", "save", "add", or "remember" a signal
- Phrases like "looking for X", "find me X", "I want to meet X" are discovery requests — NOT intent creation requests
- If the tool returns `suggestIntentCreationForVisibility: true` and `suggestedIntentDescription`, after presenting results ask: "Would you also like to create a signal for this so others can find you?" If yes, call `create_intent`. Ask only once per conversation.
- When all results are exhausted, suggest the user create a signal so others can discover them. Do not offer to "show more".

**Network scoping**: When the user says "in my network", "from my contacts", "people I know", pass the user's **personal index ID** as `indexId`. The personal index (`isPersonal: true` in their memberships) contains their contacts.

## Pattern 1a: Connect with a specific mentioned person

When the user mentions a specific person AND wants to connect ("what can I do with X", "connect me with X"):

1. Call `read_user_profiles` with the person's userId if known, or `query` with their name
2. Call `read_index_memberships` for that user to find shared indexes
3. If no shared indexes: tell the user you can't find a connection path
4. Call `create_opportunities` with `targetUserId` and `searchQuery` describing why they'd connect
5. Present the result

Do NOT call `read_intents` before `create_opportunities` here — the tool fetches intents internally.

## Pattern 2: Look up a specific person by name

When the user asks about someone ("find [name]", "who is [name]?"):

- Call `read_user_profiles` with `query` set to the name
- **One match**: present their profile naturally
- **Multiple matches**: list and ask user to clarify
- **No matches**: tell the user you couldn't find anyone by that name in their network
- If user then wants to connect, use Pattern 1a

## Pattern 3: Introduce two people

**An introduction is always between exactly two people.** You MUST gather all context before calling `create_opportunities`.

1. `read_index_memberships` for person A and person B → find shared indexes
2. If no shared indexes: tell user they're not in any shared community
3. `read_user_profiles` for both
4. For each shared index: `read_intents` for both users in that index
5. Summarize: "Here's what I found about A and B..."
6. `create_opportunities` with `partyUserIds=[A,B]`, `entities` (each party's profile + intents + shared indexId), and `hint` (user's reason)

If the user names only one person ("who should I introduce to @Person"):
- Call `create_opportunities` with `introTargetUserId` and optional `searchQuery`
- Do NOT use partyUserIds — the system finds connections automatically
- **Never suggest signal creation in introducer flows** — the query reflects the other person's needs, not the user's

## Opportunity Status

- Draft or latent opportunities can be sent: call `update_opportunity` with `status='pending'`
- Status translation: draft/latent → "draft", pending → "sent", accepted → "connected"
- "pending" sends a notification — not a message or invite
- "accepted" adds a contact — for ghost users, the invite email is sent only when the user opens a chat

## Rules

- **Discovery first, intent as follow-up.** Never lead with `create_intent` for connection-seeking requests.
- Only call `create_opportunities` for: discovery, introductions, or direct connection with a specific person.
- Only describe what the tool response confirms happened. Never claim you sent invites or messages.
