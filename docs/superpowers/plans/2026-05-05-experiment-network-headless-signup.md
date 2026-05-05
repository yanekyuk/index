# Experiment Network Headless Signup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enable networks to be flagged as "experiments" with a master API key, providing a headless signup endpoint that creates isolated user accounts scoped to the experiment network.

**Architecture:** Add `isExperiment` + `experimentMasterKeyHash` to networks table, `experimentNetworkId` to users table (compound unique with email). New `ExperimentMasterKeyGuard` validates master keys. `ExperimentService` handles signup flow (find/create user, personal network, agent + token). Existing email-based queries get `experimentNetworkId IS NULL` filter.

**Tech Stack:** Bun, Drizzle ORM, PostgreSQL, SHA-256 hashing, Zod validation

---

## File Structure

| Action | File | Responsibility |
|--------|------|----------------|
| Modify | `backend/src/schemas/database.schema.ts` | Add columns + compound unique index |
| Create | `backend/src/guards/experiment.guard.ts` | Master key validation guard |
| Create | `backend/src/services/experiment.service.ts` | Signup flow orchestration |
| Modify | `backend/src/controllers/network.controller.ts` | Add `POST /networks/:id/signup` and modify `POST /networks` for experiment creation |
| Modify | `backend/src/services/network.service.ts` | Master key provisioning on create, experiment network delete cascade |
| Modify | `backend/src/adapters/database.adapter.ts` | `getUserByEmail` filter, new experiment user queries |
| Modify | `backend/src/adapters/auth.adapter.ts` | `onConflictDoUpdate` target change for compound unique |
| Create | `backend/tests/experiment-signup.test.ts` | Integration tests |

---

### Task 1: Schema Changes

**Files:**
- Modify: `backend/src/schemas/database.schema.ts`

- [ ] **Step 1: Add `experimentNetworkId` to users table**

In `backend/src/schemas/database.schema.ts`, add the column to the `users` table definition and replace the email unique index with a compound unique:

```typescript
// Add after the `deletedAt` column (before the closing of the columns object):
experimentNetworkId: text('experiment_network_id').references(() => networks.id),

// Replace the table constraints:
}, (table) => ({
  usersEmailExperimentUnique: uniqueIndex('users_email_experiment_unique').on(table.email, table.experimentNetworkId),
  usersKeyUnique: uniqueIndex('users_key_unique').on(table.key),
}));
```

Note: This removes `usersEmailUnique` and replaces it with `usersEmailExperimentUnique`. Postgres treats NULL as distinct in unique indexes, so `(alice@example.com, NULL)` and `(alice@example.com, <network-uuid>)` are both allowed.

- [ ] **Step 2: Add `isExperiment` and `experimentMasterKeyHash` to networks table**

In the `networks` table definition, add after `isPersonal`:

```typescript
isExperiment: boolean('is_experiment').default(false).notNull(),
experimentMasterKeyHash: text('experiment_master_key_hash'),
```

- [ ] **Step 3: Generate and rename migration**

Run:
```bash
cd backend && bun run db:generate
```

Rename the generated file in `backend/drizzle/` to `NNNN_add_experiment_network_columns.sql` (where NNNN is the next sequence number). Update `drizzle/meta/_journal.json` to match the new filename (without `.sql`).

- [ ] **Step 4: Apply migration**

Run:
```bash
cd backend && bun run db:migrate
```

- [ ] **Step 5: Verify no pending changes**

Run:
```bash
cd backend && bun run db:generate
```
Expected: "No schema changes" / no new migration file generated.

- [ ] **Step 6: Commit**

```bash
git add backend/src/schemas/database.schema.ts backend/drizzle/
git commit -m "$(cat <<'EOF'
feat: add experiment network schema columns

Add experimentNetworkId to users (compound unique with email),
isExperiment and experimentMasterKeyHash to networks.
EOF
)"
```

---

### Task 2: Experiment Master Key Guard

**Files:**
- Create: `backend/src/guards/experiment.guard.ts`

- [ ] **Step 1: Create the guard file**

Create `backend/src/guards/experiment.guard.ts`:

```typescript
import { and, eq, isNull } from 'drizzle-orm';

import { db } from '../lib/drizzle/drizzle';
import * as schema from '../schemas/database.schema';

async function hashKey(key: string): Promise<string> {
  const encoded = new TextEncoder().encode(key);
  const hash = await crypto.subtle.digest('SHA-256', encoded);
  return Buffer.from(hash).toString('base64url');
}

export interface ExperimentNetwork {
  id: string;
  title: string;
}

export async function ExperimentMasterKeyGuard(
  req: Request,
  params: Record<string, string>,
): Promise<ExperimentNetwork> {
  const networkId = params.id;
  if (!networkId) {
    throw new Response(JSON.stringify({ error: 'Network ID is required' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const apiKey = req.headers.get('x-api-key');
  if (!apiKey) {
    throw new Response(JSON.stringify({ error: 'x-api-key header is required' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const [network] = await db
    .select({
      id: schema.networks.id,
      title: schema.networks.title,
      isExperiment: schema.networks.isExperiment,
      experimentMasterKeyHash: schema.networks.experimentMasterKeyHash,
    })
    .from(schema.networks)
    .where(and(
      eq(schema.networks.id, networkId),
      isNull(schema.networks.deletedAt),
    ))
    .limit(1);

  if (!network || !network.isExperiment || !network.experimentMasterKeyHash) {
    throw new Response(JSON.stringify({ error: 'Forbidden' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const hashedKey = await hashKey(apiKey);
  if (hashedKey !== network.experimentMasterKeyHash) {
    throw new Response(JSON.stringify({ error: 'Forbidden' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  return { id: network.id, title: network.title };
}
```

- [ ] **Step 2: Commit**

```bash
git add backend/src/guards/experiment.guard.ts
git commit -m "$(cat <<'EOF'
feat: add ExperimentMasterKeyGuard for headless signup auth
EOF
)"
```

---

### Task 3: Experiment Service

**Files:**
- Create: `backend/src/services/experiment.service.ts`

- [ ] **Step 1: Create the experiment service**

Create `backend/src/services/experiment.service.ts`:

```typescript
import { and, eq, isNull, sql } from 'drizzle-orm';

import { db } from '../lib/drizzle/drizzle';
import { log } from '../lib/log';
import * as schema from '../schemas/database.schema';
import { ensurePersonalNetwork } from '../adapters/database.adapter';
import { agentService } from './agent.service';

const logger = log.service.from('experiment');

export interface ExperimentSignupResult {
  user: { id: string; email: string };
  apiKey: string;
  created: boolean;
}

class ExperimentService {
  async signup(networkId: string, email: string): Promise<ExperimentSignupResult> {
    const normalizedEmail = email.toLowerCase().trim();
    logger.verbose('[ExperimentService] Signup attempt', { networkId, email: normalizedEmail });

    // Step 1: Find or create user scoped to this experiment network
    const { user, created } = await this.findOrCreateUser(normalizedEmail, networkId);

    // Step 2: Ensure personal network
    await ensurePersonalNetwork(user.id);

    // Step 3: Join experiment network (idempotent upsert)
    await this.joinExperimentNetwork(user.id, networkId);

    // Step 4: Create personal agent + token
    const apiKey = await this.createAgentAndToken(user.id);

    logger.info('[ExperimentService] Signup complete', {
      userId: user.id,
      networkId,
      created,
    });

    return {
      user: { id: user.id, email: user.email },
      apiKey,
      created,
    };
  }

  private async findOrCreateUser(
    email: string,
    experimentNetworkId: string,
  ): Promise<{ user: { id: string; email: string }; created: boolean }> {
    // Check for existing user in this experiment
    const [existing] = await db
      .select({ id: schema.users.id, email: schema.users.email })
      .from(schema.users)
      .where(and(
        eq(schema.users.email, email),
        eq(schema.users.experimentNetworkId, experimentNetworkId),
        isNull(schema.users.deletedAt),
      ))
      .limit(1);

    if (existing) {
      return { user: existing, created: false };
    }

    // Create new experiment user
    const [newUser] = await db
      .insert(schema.users)
      .values({
        email,
        name: email.split('@')[0],
        emailVerified: true,
        isGhost: false,
        experimentNetworkId,
      })
      .onConflictDoNothing()
      .returning({ id: schema.users.id, email: schema.users.email });

    // Handle race condition: if onConflictDoNothing fired, re-query
    if (!newUser) {
      const [raced] = await db
        .select({ id: schema.users.id, email: schema.users.email })
        .from(schema.users)
        .where(and(
          eq(schema.users.email, email),
          eq(schema.users.experimentNetworkId, experimentNetworkId),
          isNull(schema.users.deletedAt),
        ))
        .limit(1);

      if (!raced) throw new Error('Failed to create experiment user');
      return { user: raced, created: false };
    }

    return { user: newUser, created: true };
  }

  private async joinExperimentNetwork(userId: string, networkId: string): Promise<void> {
    await db
      .insert(schema.networkMembers)
      .values({
        networkId,
        userId,
        permissions: ['member'],
      })
      .onConflictDoNothing();
  }

  private async createAgentAndToken(userId: string): Promise<string> {
    const agent = await agentService.create(userId, 'Personal Agent');
    const token = await agentService.createToken(agent.id, userId);
    return token.key;
  }
}

export const experimentService = new ExperimentService();
```

- [ ] **Step 2: Commit**

```bash
git add backend/src/services/experiment.service.ts
git commit -m "$(cat <<'EOF'
feat: add ExperimentService for headless signup flow
EOF
)"
```

---

### Task 4: Network Controller — Signup Endpoint

**Files:**
- Modify: `backend/src/controllers/network.controller.ts`

- [ ] **Step 1: Add the signup endpoint to the network controller**

Add import at the top of `backend/src/controllers/network.controller.ts`:

```typescript
import { ExperimentMasterKeyGuard, type ExperimentNetwork } from '../guards/experiment.guard';
import { experimentService } from '../services/experiment.service';
```

Add the following method to the `NetworkController` class (after the `create` method):

```typescript
  /**
   * Headless signup for experiment networks. Authenticated via master key (x-api-key header).
   */
  @Post('/:id/signup')
  async signup(req: Request, _user: unknown, params: Record<string, string>) {
    let network: ExperimentNetwork;
    try {
      network = await ExperimentMasterKeyGuard(req, params);
    } catch (err) {
      if (err instanceof Response) return err;
      throw err;
    }

    const body = await req.json().catch(() => ({})) as { email?: string };
    if (!body.email || typeof body.email !== 'string') {
      return new Response(JSON.stringify({ error: 'email is required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(body.email)) {
      return new Response(JSON.stringify({ error: 'Invalid email format' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    try {
      const result = await experimentService.signup(network.id, body.email);
      const status = result.created ? 201 : 200;
      return Response.json({ user: result.user, apiKey: result.apiKey }, { status });
    } catch (err: unknown) {
      logger.error('Experiment signup failed', { networkId: network.id, error: errorMessage(err) });
      return new Response(JSON.stringify({ error: 'Signup failed' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  }
```

Note: This endpoint has NO `@UseGuards(AuthGuard)` decorator — it uses `ExperimentMasterKeyGuard` manually inside the method body.

- [ ] **Step 2: Commit**

```bash
git add backend/src/controllers/network.controller.ts
git commit -m "$(cat <<'EOF'
feat: add POST /networks/:id/signup endpoint for experiment headless signup
EOF
)"
```

---

### Task 5: Master Key Provisioning on Network Creation

**Files:**
- Modify: `backend/src/services/network.service.ts`
- Modify: `backend/src/controllers/network.controller.ts`

- [ ] **Step 1: Add master key generation to NetworkService**

In `backend/src/services/network.service.ts`, add at the top (after existing imports):

```typescript
import { eq } from 'drizzle-orm';

import { db } from '../lib/drizzle/drizzle';
import * as schema from '../schemas/database.schema';
```

Add a new method to the `NetworkService` class:

```typescript
  async createExperimentNetwork(userId: string, data: { title: string; prompt?: string; imageUrl?: string | null }): Promise<{ network: any; masterKey: string }> {
    logger.verbose('[NetworkService] Creating experiment network', { userId, title: data.title });

    // Generate master key
    const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
    const bytes = crypto.getRandomValues(new Uint8Array(64));
    let masterKey = '';
    for (let i = 0; i < 64; i++) {
      masterKey += chars[bytes[i] % chars.length];
    }

    // Hash the key
    const encoded = new TextEncoder().encode(masterKey);
    const hashBuffer = await crypto.subtle.digest('SHA-256', encoded);
    const masterKeyHash = Buffer.from(hashBuffer).toString('base64url');

    // Create network with experiment flags
    const network = await this.adapter.createNetwork({
      title: data.title,
      prompt: data.prompt,
      imageUrl: data.imageUrl,
      joinPolicy: 'invite_only',
      allowGuestVibeCheck: false,
    });

    // Set experiment columns
    await db
      .update(schema.networks)
      .set({
        isExperiment: true,
        experimentMasterKeyHash: masterKeyHash,
      })
      .where(eq(schema.networks.id, network.id));

    // Add creator as owner
    await this.adapter.addMemberToNetwork(network.id, userId, 'owner');

    const fullNetwork = await this.adapter.getNetworkDetail(network.id, userId);
    if (!fullNetwork) throw new Error('Failed to create experiment network');

    return { network: fullNetwork, masterKey };
  }
```

- [ ] **Step 2: Update network controller create endpoint**

In `backend/src/controllers/network.controller.ts`, modify the `create` method to handle experiment networks. Replace the existing `create` method body:

```typescript
  @Post('')
  @UseGuards(AuthGuard)
  async create(req: Request, user: AuthenticatedUser) {
    const body = await req.json().catch(() => ({})) as {
      title?: string;
      prompt?: string;
      imageUrl?: string | null;
      joinPolicy?: 'anyone' | 'invite_only';
      allowGuestVibeCheck?: boolean;
      isExperiment?: boolean;
    };

    if (!body.title) {
      return new Response(JSON.stringify({ error: 'title is required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (body.isExperiment) {
      const { network, masterKey } = await networkService.createExperimentNetwork(user.id, {
        title: body.title,
        prompt: body.prompt,
        imageUrl: body.imageUrl,
      });
      logger.verbose('Experiment network created', { networkId: network.id, userId: user.id });
      return Response.json({ network, masterKey }, { status: 201 });
    }

    const result = await networkService.createNetwork(user.id, {
      title: body.title,
      prompt: body.prompt,
      imageUrl: body.imageUrl,
      joinPolicy: body.joinPolicy,
      allowGuestVibeCheck: body.allowGuestVibeCheck,
    });
    logger.verbose('Network created', { networkId: result.id, userId: user.id });
    return Response.json({ network: result });
  }
```

- [ ] **Step 3: Commit**

```bash
git add backend/src/services/network.service.ts backend/src/controllers/network.controller.ts
git commit -m "$(cat <<'EOF'
feat: provision master key when creating experiment networks
EOF
)"
```

---

### Task 6: Existing Query Safety — Filter `experimentNetworkId IS NULL`

**Files:**
- Modify: `backend/src/adapters/database.adapter.ts`
- Modify: `backend/src/adapters/auth.adapter.ts`

- [ ] **Step 1: Update `getUserByEmail` in database adapter**

In `backend/src/adapters/database.adapter.ts` at line 2914, modify the `where` clause in `getUserByEmail`:

Replace:
```typescript
      .where(and(
        sql`lower(${schema.users.email}) = ${normalized}`,
        isNull(schema.users.deletedAt),
      ))
```

With:
```typescript
      .where(and(
        sql`lower(${schema.users.email}) = ${normalized}`,
        isNull(schema.users.deletedAt),
        isNull(schema.users.experimentNetworkId),
      ))
```

- [ ] **Step 2: Update auth adapter's `onConflictDoUpdate` target**

In `backend/src/adapters/auth.adapter.ts`, the `onConflictDoUpdate` at line ~63 uses `target: schema.users.email`. This needs updating because the unique index changed. Replace:

```typescript
            .onConflictDoUpdate({
              target: schema.users.email,
              set: {
                name: sql`EXCLUDED."name"`,
                avatar: sql`EXCLUDED."avatar"`,
                isGhost: sql`false`,
                updatedAt: sql`now()`,
              },
              setWhere: sql`${schema.users.isGhost} = true`,
            })
```

With:
```typescript
            .onConflictDoUpdate({
              target: [schema.users.email, schema.users.experimentNetworkId],
              set: {
                name: sql`EXCLUDED."name"`,
                avatar: sql`EXCLUDED."avatar"`,
                isGhost: sql`false`,
                updatedAt: sql`now()`,
              },
              setWhere: sql`${schema.users.isGhost} = true AND ${schema.users.experimentNetworkId} IS NULL`,
            })
```

This ensures:
- The conflict target matches the new compound unique index
- Only organic ghost users (experimentNetworkId IS NULL) get claimed
- Experiment users are never accidentally overwritten

- [ ] **Step 3: Verify no other email-based user lookups need patching**

Run:
```bash
cd backend && grep -rn "users.email\|user\.email" src/adapters/ src/services/ --include="*.ts" | grep -i "where\|eq\|find\|lookup\|select" | grep -v "test\|spec\|\.d\.ts"
```

Review each hit. The main ones are:
- `database.adapter.ts:getUserByEmail` — patched in step 1
- `auth.adapter.ts` upsert — patched in step 2
- `contact.service.ts:addContact` — calls `getUserByEmail` (already patched)

If any additional queries need the filter, add `isNull(schema.users.experimentNetworkId)` to their `where` clause.

- [ ] **Step 4: Commit**

```bash
git add backend/src/adapters/database.adapter.ts backend/src/adapters/auth.adapter.ts
git commit -m "$(cat <<'EOF'
fix: filter experimentNetworkId IS NULL in all email-based user lookups

Prevents organic auth flows from resolving to experiment user accounts.
EOF
)"
```

---

### Task 7: Network Visibility Scoping for Experiment Users

**Files:**
- Modify: `backend/src/adapters/database.adapter.ts`

- [ ] **Step 1: Add experiment visibility filter to `getNetworksForUser`**

In `backend/src/adapters/database.adapter.ts`, in the `getNetworksForUser` method (around line 1246), after fetching network IDs, add a filter. The user's `experimentNetworkId` determines visibility.

Before the method fetches networks, add a check. Find where `getNetworksForUser` is defined and add logic to scope experiment users. The simplest approach: look up the user's `experimentNetworkId` and if it's set, restrict the returned networks to just their personal network and the experiment network.

At the start of `getNetworksForUser`, add:

```typescript
  async getNetworksForUser(userId: string) {
    // Check if user is an experiment user
    const [userRow] = await db
      .select({ experimentNetworkId: schema.users.experimentNetworkId })
      .from(schema.users)
      .where(eq(schema.users.id, userId))
      .limit(1);

    const experimentNetworkId = userRow?.experimentNetworkId;
```

Then, in the `where` clause that filters the final network rows (the query around line 1300 with `inArray(schema.networks.id, ids)`), add an additional condition if `experimentNetworkId` is set:

```typescript
    // If experiment user, restrict to personal + experiment network only
    let allowedIds = ids;
    if (experimentNetworkId) {
      allowedIds = ids.filter(id => {
        // Will be filtered further below — keep experiment network + personal
        return true; // Let the SQL filter handle it
      });
    }
```

Actually, the simpler approach: add a SQL condition to the final `where`:

After the existing `where` conditions in the final query, add:

```typescript
    const extraCondition = experimentNetworkId
      ? or(eq(schema.networks.isPersonal, true), eq(schema.networks.id, experimentNetworkId))
      : undefined;
```

And include `extraCondition` in the `and(...)` of the final query's `.where()`.

- [ ] **Step 2: Commit**

```bash
git add backend/src/adapters/database.adapter.ts
git commit -m "$(cat <<'EOF'
feat: scope network visibility for experiment users

Experiment users can only see their personal network and their
experiment network when listing networks.
EOF
)"
```

---

### Task 8: Cascading Soft Delete for Experiment Networks

**Files:**
- Modify: `backend/src/services/network.service.ts`
- Modify: `backend/src/adapters/database.adapter.ts`

- [ ] **Step 1: Add cascading soft delete method to database adapter**

In `backend/src/adapters/database.adapter.ts`, add a new method to the `DatabaseAdapter` class:

```typescript
  async softDeleteExperimentNetwork(networkId: string): Promise<void> {
    const now = new Date();

    // Find all experiment users scoped to this network
    const experimentUsers = await db
      .select({ id: schema.users.id })
      .from(schema.users)
      .where(and(
        eq(schema.users.experimentNetworkId, networkId),
        isNull(schema.users.deletedAt),
      ));

    const userIds = experimentUsers.map(u => u.id);

    if (userIds.length > 0) {
      // Soft-delete users
      await db
        .update(schema.users)
        .set({ deletedAt: now, updatedAt: now })
        .where(inArray(schema.users.id, userIds));

      // Soft-delete their intents
      await db
        .update(schema.intents)
        .set({ deletedAt: now, updatedAt: now })
        .where(inArray(schema.intents.userId, userIds));

      // Delete their intent_networks (hard delete, same as existing softDeleteNetwork)
      await db
        .delete(schema.intentNetworks)
        .where(inArray(schema.intentNetworks.intentId,
          db.select({ id: schema.intents.id }).from(schema.intents).where(inArray(schema.intents.userId, userIds))
        ));

      // Soft-delete their network memberships
      await db
        .update(schema.networkMembers)
        .set({ deletedAt: now, updatedAt: now })
        .where(inArray(schema.networkMembers.userId, userIds));

      // Soft-delete their personal networks
      const personalNetworkIds = await db
        .select({ networkId: schema.personalNetworks.networkId })
        .from(schema.personalNetworks)
        .where(inArray(schema.personalNetworks.userId, userIds));

      if (personalNetworkIds.length > 0) {
        await db
          .update(schema.networks)
          .set({ deletedAt: now, updatedAt: now })
          .where(inArray(schema.networks.id, personalNetworkIds.map(p => p.networkId)));
      }

      // Soft-delete their agents
      await db
        .update(schema.agents)
        .set({ deletedAt: now, updatedAt: now })
        .where(inArray(schema.agents.ownerId, userIds));

      // Disable their API keys
      await db
        .update(schema.apikeys)
        .set({ enabled: false, updatedAt: now })
        .where(inArray(schema.apikeys.userId, userIds));

      // Soft-delete opportunities where user is involved
      await db
        .update(schema.opportunities)
        .set({ deletedAt: now, updatedAt: now })
        .where(or(
          inArray(schema.opportunities.sourceUserId, userIds),
          inArray(schema.opportunities.targetUserId, userIds),
        ));
    }

    // Delete experiment network memberships (hard delete, same pattern as existing)
    await db.delete(schema.networkMembers).where(eq(schema.networkMembers.networkId, networkId));

    // Delete intent_networks for the experiment network
    await db.delete(schema.intentNetworks).where(eq(schema.intentNetworks.networkId, networkId));

    // Soft-delete the experiment network itself
    await db
      .update(schema.networks)
      .set({ deletedAt: now, updatedAt: now })
      .where(eq(schema.networks.id, networkId));
  }
```

- [ ] **Step 2: Update NetworkService.deleteNetwork to use cascade for experiments**

In `backend/src/services/network.service.ts`, modify `deleteNetwork`:

```typescript
  async deleteNetwork(networkId: string, userId: string) {
    logger.verbose('[NetworkService] Deleting index', { networkId, userId });
    await this.assertNotPersonal(networkId);

    // Check if this is an experiment network
    const [network] = await db
      .select({ isExperiment: schema.networks.isExperiment })
      .from(schema.networks)
      .where(eq(schema.networks.id, networkId))
      .limit(1);

    if (network?.isExperiment) {
      // Verify ownership first
      const isOwner = await this.adapter.isIndexOwner(networkId, userId);
      if (!isOwner) throw new Error('Access denied: Not an owner of this index');
      await this.adapter.softDeleteExperimentNetwork(networkId);
    } else {
      await this.adapter.deleteIndexForOwner(networkId, userId);
    }
  }
```

- [ ] **Step 3: Commit**

```bash
git add backend/src/adapters/database.adapter.ts backend/src/services/network.service.ts
git commit -m "$(cat <<'EOF'
feat: cascading soft delete for experiment networks

Soft-deletes all experiment users and their data (intents, opportunities,
agents, API keys, personal networks) when an experiment network is deleted.
EOF
)"
```

---

### Task 9: Immutability Guard — Prevent `isExperiment` Modification

**Files:**
- Modify: `backend/src/controllers/network.controller.ts`

- [ ] **Step 1: Block `isExperiment` in network update endpoint**

Find the update/patch endpoint in `backend/src/controllers/network.controller.ts`. In the body parsing for the PATCH endpoint, strip `isExperiment` and `experimentMasterKeyHash` if present (or reject the request). Add after body parsing:

```typescript
    if ('isExperiment' in body || 'experimentMasterKeyHash' in body) {
      return new Response(JSON.stringify({ error: 'Cannot modify experiment settings after creation' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Prevent changing join policy on experiment networks
    if (body.joinPolicy || body.allowGuestVibeCheck !== undefined) {
      const [network] = await db
        .select({ isExperiment: schema.networks.isExperiment })
        .from(schema.networks)
        .where(eq(schema.networks.id, params.id))
        .limit(1);
      if (network?.isExperiment) {
        return new Response(JSON.stringify({ error: 'Cannot modify join policy on experiment networks' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        });
      }
    }
```

- [ ] **Step 2: Commit**

```bash
git add backend/src/controllers/network.controller.ts
git commit -m "$(cat <<'EOF'
fix: prevent modification of isExperiment after network creation
EOF
)"
```

---

### Task 10: Integration Tests

**Files:**
- Create: `backend/tests/experiment-signup.test.ts`

- [ ] **Step 1: Write the integration test file**

Create `backend/tests/experiment-signup.test.ts`:

```typescript
import { afterAll, beforeAll, describe, expect, it } from 'bun:test';

// Load env before any other imports
import '../src/lib/env';

import { db } from '../src/lib/drizzle/drizzle';
import * as schema from '../src/schemas/database.schema';
import { eq, and, isNull } from 'drizzle-orm';

const BASE_URL = `http://localhost:${process.env.PORT || 3001}`;

let authToken: string;
let experimentNetworkId: string;
let masterKey: string;

async function getAuthToken(): Promise<string> {
  // Use existing test auth mechanism
  const res = await fetch(`${BASE_URL}/api/auth/sign-in/email`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: process.env.TEST_USER_EMAIL || 'test@indexnetwork.dev',
      password: process.env.TEST_USER_PASSWORD || 'testpassword',
    }),
  });
  const cookies = res.headers.getSetCookie();
  const sessionCookie = cookies.find(c => c.startsWith('better-auth.session_token='));
  return sessionCookie?.split('=')[1]?.split(';')[0] || '';
}

describe('Experiment Network Headless Signup', () => {
  beforeAll(async () => {
    authToken = await getAuthToken();
  });

  afterAll(async () => {
    // Cleanup: delete experiment network and cascaded data
    if (experimentNetworkId) {
      await db.delete(schema.networkMembers).where(eq(schema.networkMembers.networkId, experimentNetworkId));
      await db.delete(schema.networks).where(eq(schema.networks.id, experimentNetworkId));
      await db.delete(schema.users).where(eq(schema.users.experimentNetworkId, experimentNetworkId));
    }
  });

  describe('POST /networks (experiment creation)', () => {
    it('should create an experiment network and return master key', async () => {
      const res = await fetch(`${BASE_URL}/api/networks`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Cookie': `better-auth.session_token=${authToken}`,
        },
        body: JSON.stringify({
          title: 'Test Experiment',
          prompt: 'A test experiment network',
          isExperiment: true,
        }),
      });

      expect(res.status).toBe(201);
      const data = await res.json();
      expect(data.network).toBeDefined();
      expect(data.masterKey).toBeDefined();
      expect(typeof data.masterKey).toBe('string');
      expect(data.masterKey.length).toBe(64);

      experimentNetworkId = data.network.id;
      masterKey = data.masterKey;
    });
  });

  describe('POST /networks/:id/signup', () => {
    it('should reject without x-api-key', async () => {
      const res = await fetch(`${BASE_URL}/api/networks/${experimentNetworkId}/signup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'alice@example.com' }),
      });
      expect(res.status).toBe(401);
    });

    it('should reject with wrong master key', async () => {
      const res = await fetch(`${BASE_URL}/api/networks/${experimentNetworkId}/signup`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': 'wrongkeywrongkeywrongkeywrongkeywrongkeywrongkeywrongkeywrongkey1',
        },
        body: JSON.stringify({ email: 'alice@example.com' }),
      });
      expect(res.status).toBe(403);
    });

    it('should reject on non-experiment network', async () => {
      const res = await fetch(`${BASE_URL}/api/networks/nonexistent-id/signup`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': masterKey,
        },
        body: JSON.stringify({ email: 'alice@example.com' }),
      });
      expect(res.status).toBe(403);
    });

    it('should create a new user and return API key (201)', async () => {
      const res = await fetch(`${BASE_URL}/api/networks/${experimentNetworkId}/signup`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': masterKey,
        },
        body: JSON.stringify({ email: 'experiment-alice@example.com' }),
      });

      expect(res.status).toBe(201);
      const data = await res.json();
      expect(data.user.id).toBeDefined();
      expect(data.user.email).toBe('experiment-alice@example.com');
      expect(data.apiKey).toBeDefined();
      expect(typeof data.apiKey).toBe('string');

      // Verify user has experimentNetworkId set
      const [user] = await db
        .select()
        .from(schema.users)
        .where(eq(schema.users.id, data.user.id))
        .limit(1);
      expect(user.experimentNetworkId).toBe(experimentNetworkId);
    });

    it('should return existing user with new API key on repeat call (200)', async () => {
      const res = await fetch(`${BASE_URL}/api/networks/${experimentNetworkId}/signup`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': masterKey,
        },
        body: JSON.stringify({ email: 'experiment-alice@example.com' }),
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.user.email).toBe('experiment-alice@example.com');
      expect(data.apiKey).toBeDefined();
    });

    it('should reject invalid email', async () => {
      const res = await fetch(`${BASE_URL}/api/networks/${experimentNetworkId}/signup`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': masterKey,
        },
        body: JSON.stringify({ email: 'not-an-email' }),
      });
      expect(res.status).toBe(400);
    });

    it('should isolate experiment users from normal auth', async () => {
      // The experiment user should NOT be findable via getUserByEmail (organic lookup)
      const [organicMatch] = await db
        .select()
        .from(schema.users)
        .where(and(
          eq(schema.users.email, 'experiment-alice@example.com'),
          isNull(schema.users.experimentNetworkId),
          isNull(schema.users.deletedAt),
        ))
        .limit(1);
      expect(organicMatch).toBeUndefined();
    });
  });

  describe('Network immutability', () => {
    it('should reject attempts to modify isExperiment', async () => {
      const res = await fetch(`${BASE_URL}/api/networks/${experimentNetworkId}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'Cookie': `better-auth.session_token=${authToken}`,
        },
        body: JSON.stringify({ isExperiment: false }),
      });
      expect(res.status).toBe(400);
    });
  });
}, { timeout: 30_000 });
```

- [ ] **Step 2: Run the test to verify it fails (no server running = connection refused, or schema not yet applied)**

Run:
```bash
cd backend && bun test tests/experiment-signup.test.ts
```

Expected: Tests fail (either because the endpoint doesn't exist yet or server isn't running). This validates the test file is syntactically correct.

- [ ] **Step 3: Commit**

```bash
git add backend/tests/experiment-signup.test.ts
git commit -m "$(cat <<'EOF'
test: add integration tests for experiment network headless signup
EOF
)"
```

---

### Task 11: Final Verification

- [ ] **Step 1: Type-check the entire backend**

Run:
```bash
cd backend && bunx tsc --noEmit
```

Fix any type errors.

- [ ] **Step 2: Run lint**

Run:
```bash
cd backend && bun run lint
```

Fix any lint errors.

- [ ] **Step 3: Run the experiment signup tests with dev server**

Start the dev server in one terminal:
```bash
cd backend && bun run dev
```

In another terminal, run:
```bash
cd backend && bun test tests/experiment-signup.test.ts
```

Expected: All tests pass.

- [ ] **Step 4: Run the full test suite to check for regressions**

```bash
cd backend && bun test
```

Verify no existing tests broke (especially auth-related tests that may rely on the old email unique index).

- [ ] **Step 5: Final commit if any fixes were needed**

```bash
git add -A
git commit -m "$(cat <<'EOF'
fix: address type errors and lint issues from experiment signup implementation
EOF
)"
```
