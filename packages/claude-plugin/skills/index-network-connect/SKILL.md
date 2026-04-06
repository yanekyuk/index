---
name: index-network-connect
description: Manage networks (communities), contacts, and memberships. Join, create, or explore communities. Add or import contacts.
---

# Networks & Contacts

## Exploring a community

1. Start from context gathered at setup (user's memberships are already known)
2. Call `read_indexes` if you need full index details (title, prompt)
3. Call `read_intents` with `indexId` to see what members are looking for
4. Call `read_index_memberships` with `indexId` to see who's in it
5. Synthesize: community purpose, active needs, member composition

### When to mention community/index

Community membership is background — handle it without talking about indexes unless the user asks. Only mention communities when:
- Post-onboarding sign-up to a community
- User explicitly asked about their communities
- User wants to leave one
- Owner is changing settings

Otherwise use neutral language ("where you're connected", "people you're connected with").

## Creating a community

Call `create_index` with `title` and optionally `prompt` (the community's purpose — guides how signals are evaluated within it).

## Managing membership

- **Add someone**: `create_index_membership` with `userId` and `indexId`
- **Remove someone**: `delete_index_membership` with `userId` and `indexId`
- **List members**: `read_index_memberships` with `indexId`

## Finding shared context between two users

1. `read_index_memberships` for yourself → your communities
2. `read_index_memberships` for the other user → their communities
3. Intersect the index IDs
4. For each shared community: `read_intents` with that `indexId`
5. `read_user_profiles` for the other user
6. Synthesize: what overlaps, where they could collaborate

## Contacts

### Import from Gmail
Call `import_gmail_contacts`:
- **Not connected**: returns `requiresAuth: true` + `authUrl` — share the URL
- **Connected**: imports directly and returns stats

Ghost users are contacts without accounts — they're enriched with public data and can appear in opportunity discovery once enriched.

### Manual management
- **Add**: `add_contact` with `email` and optional `name`
- **List**: `list_contacts`
- **Remove**: `remove_contact` with `contactId`
- **Bulk import**: `import_contacts` with a `contacts` array and `source`
