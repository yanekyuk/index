---
name: index-network-signal
description: Create, update, and manage intents (signals) — what the user is looking for or offering.
---

# Signals (Intents)

## Creating a signal

**YOU decide if it's specific enough. The tool proposes — the user confirms.**

If the description is vague ("find a job", "meet people", "learn something"):
1. Call `read_user_profiles` (no args) → get their background
2. Call `read_intents` (no args) → see existing signals for context
3. Given their profile and existing signals, suggest a refined version
4. Reply: "Based on your background in X, did you mean something like 'Y'?"
5. Wait for confirmation
6. On "yes" → call `create_intent` with the exact refined text

If the description is specific enough ("contribute to an open-source LLM project"):
→ Call `create_intent` directly

**Specificity test**: Does it contain a concrete domain, action, or scope? If just a single generic verb+noun ("find a job"), it's vague. If it has qualifying detail ("senior UX design role at a tech company in Berlin"), it's specific.

After `create_intent` returns, present the result to the user and explain: "Creating this signal will let the system look for relevant people in the background." Ask for their confirmation before considering it done.

## Updating or deleting a signal

**YOU look up the ID first.**

1. Call `read_intents` → get current signals with IDs
2. Match user's request to the right signal
3. Call `update_intent` with `intentId` and `newDescription`, or `delete_intent` with `intentId`

## URLs in signal creation

**YOU handle scraping before intent creation.**

1. Call `scrape_url` with the URL and `objective="Extract key details for a signal"`
2. Synthesize a conceptual description from scraped content
3. Call `create_intent` with the synthesized summary

Exception: for profile creation, pass URLs directly to `create_user_profile` (it handles scraping internally).

## Rules

- The system automatically assigns signals to relevant communities in the background — you do NOT need to call `create_intent_index` after creating a signal
- Never write a proposal yourself — only the `create_intent` tool provides valid proposals
- Always check for existing similar signals before creating new ones
