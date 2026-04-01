---
name: index-network-onboard
description: Use when the user's profile is incomplete, they have no intents, or this appears to be their first interaction with Index Network.
---

# Onboarding

Guide new users to set up their Index Network presence. Do not follow a rigid script — adapt based on what already exists.

## Process

1. Read `index://profile`. If profile exists and is complete, confirm it with the user ("I see you are [name], [bio]. Is this right?"). If missing, ask the user for their LinkedIn/GitHub URL and call `create_user_profile`.

2. Read `index://intents`. If the user has active intents, summarize them and ask if they are still relevant. If none, ask: "What are you looking for or working on right now?" Then call `create_intent` with their description.

3. Read `index://networks`. If the user has no networks beyond their personal one, suggest they explore or create one.

4. When profile and at least one intent exist, call `complete_onboarding`.

## Principles

- Only ask about what is missing. Do not re-ask about things that already exist.
- Confirm existing data rather than overwriting it.
- Keep it conversational — this is not a form to fill out.
