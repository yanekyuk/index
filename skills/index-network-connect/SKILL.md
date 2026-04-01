---
name: index-network-connect
description: Use when the user wants to manage networks (create, join, leave, invite), manage contacts (add, remove, import), or handle community memberships.
---

# Networks & Contacts

Help users manage their communities and personal network.

## Prerequisites

The parent skill (index-network) has already verified CLI availability and auth. Context has been gathered silently.

## Networks

List networks:

```
index network list --json
```

Create a new network:

```
index network create "<name>" --prompt "<purpose>" --json
```

When creating a network, help the user write a good prompt — it guides how the system evaluates intents within that community.

Update network title or prompt (owner only):

```
index network update <id> --title "<new title>" --prompt "<new prompt>" --json
```

Delete a network (owner only):

```
index network delete <id> --json
```

Show network members:

```
index network show <id> --json
```

Invite someone by email:

```
index network invite <id> <email> --json
```

Join a public network:

```
index network join <id> --json
```

Leave a network:

```
index network leave <id> --json
```

## Contacts

List contacts:

```
index contact list --json
```

Add someone by email (creates a ghost user if they are not on the platform):

```
index contact add <email> --json
```

Remove a contact:

```
index contact remove <email> --json
```

Bulk import:

```
index contact import --json
```

Import from Gmail (opens browser for OAuth):

```
index contact import --gmail --json
```

## Join Policies

Networks have join policies: `public` (anyone can join) or `invite_only` (requires invitation). When a user asks to join a network, check the policy first by running `index network show <id> --json`.

After any network or contact mutation, silently re-run the relevant list command to refresh context.
