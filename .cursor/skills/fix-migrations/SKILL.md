---
name: fix-migrations
description: Fix a ruined Drizzle migration on local
disable-model-invocation: true
---

# fix-migrations

Fix a ruined Drizzle migration on local by running the project script.

**What it does:** Resets Postgres, stashes the current `drizzle/` folder, generates one fresh migration from the schema, adds `CREATE EXTENSION IF NOT EXISTS vector;` to it, applies the migration, then restores the original `drizzle/` folder. The DB ends up in a clean state matching the schema.

**How to run:** From the repo root, run:

```bash
cd protocol && bun run maintenance:fix-migrations
```

Or from `protocol/`:

```bash
bun run maintenance:fix-migrations
```

The script is at `protocol/scripts/fix-migrations.sh` and can also be run directly: `./scripts/fix-migrations.sh` from `protocol/`.
