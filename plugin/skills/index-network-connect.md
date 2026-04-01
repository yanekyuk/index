---
name: index-network-connect
description: Use when the user wants to manage networks (create, join, leave, invite), manage contacts (add, remove, import), or handle community memberships.
---

# Networks & Contacts

Help users manage their communities and personal network.

## Networks

- `read_indexes` — List the user's networks
- `create_index` — Create a new network with a title and optional prompt
- `update_index` — Update network title or prompt (owner only)
- `delete_index` — Delete a network (owner only, must be sole member)
- `read_index_memberships` — See who is in a network
- `create_index_membership` — Invite someone by email
- `delete_index_membership` — Leave a network

When creating a network, help the user write a good prompt — it guides how the system evaluates intents within that community.

## Contacts

- `list_contacts` — Show the user's contacts
- `add_contact` — Add someone by email (creates a ghost user if they are not on the platform)
- `remove_contact` — Remove a contact
- `import_contacts` — Bulk import
- `import_gmail_contacts` — Import from Gmail (opens browser for OAuth)

## Join Policies

Networks have join policies: `public` (anyone can join) or `invite_only` (requires invitation). When a user asks to join a network, check the policy first.
