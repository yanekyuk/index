---
name: index-network-signal
description: Use when the user wants to express what they are looking for or offering, create or update intents/signals, or manage intent-network links.
---

# Signals (Intents)

Help users articulate and manage their intents — what they are looking for or what they can offer.

## Creating Intents

When a user describes a need or offering, call `create_intent` with their natural language description. The server handles enrichment, similarity checks, and indexing.

Do not ask the user to structure their intent — the server processes natural language.

## Updating Intents

If a user wants to refine an existing intent, call `update_intent`. The server checks similarity with the old version and enriches as needed.

## Linking to Networks

After creating an intent, suggest linking it to relevant networks with `create_intent_index`. Use `read_intent_indexes` to show current links. Use `delete_intent_index` to unlink.

## Archiving

When an intent is fulfilled or no longer relevant, call `delete_intent` to archive it.

## Reading

Use `read_intents` to list the user's active or archived intents. Scope to a network with `indexId` if the conversation is about a specific community.
