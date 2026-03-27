/**
 * Integration tests for Personal Index lifecycle.
 * Verifies ensurePersonalIndex, getPersonalIndexId, contact sync,
 * contact removal cleanup, getIndexMemberships filtering, and isPersonalIndex.
 *
 * Requires DATABASE_URL and migrated schema.
 * Run: bun test src/adapters/tests/personal-index.adapter.spec.ts
 */

/** Config — must come before any project imports */
import { config } from 'dotenv';
config({ path: '.env.test' });

import { describe, expect, it, beforeAll, afterAll } from 'bun:test';
import { eq, and, inArray } from 'drizzle-orm';

import db from '../../lib/drizzle/drizzle';
import {
  users,
  userProfiles,
  networks,
  networkMembers,
  intents,
  intentNetworks,
  personalNetworks,
} from '../../schemas/database.schema';
import {
  ensurePersonalIndex,
  getPersonalIndexId,
  ChatDatabaseAdapter,
} from '../database.adapter';
import { NetworkService } from '../../services/network.service';

const TEST_PREFIX = 'personal_idx_' + Date.now() + '_';

interface TestFixture {
  ownerUserId: string;
  contactUserId: string;
  otherUserId: string;
  personalIndexId: string;
  regularIndexId: string;
  contactIntentId: string;
  /** IDs created during tests that need cleanup */
  extraIntentIndexIds: string[];
  extraMemberIndexIds: string[];
}

let fixture: TestFixture;

beforeAll(async () => {
  const ownerUserId = crypto.randomUUID();
  const contactUserId = crypto.randomUUID();
  const otherUserId = crypto.randomUUID();

  // Create test users
  await db.insert(users).values([
    { id: ownerUserId, email: TEST_PREFIX + 'owner@test.com', name: TEST_PREFIX + 'Owner' },
    { id: contactUserId, email: TEST_PREFIX + 'contact@test.com', name: TEST_PREFIX + 'Contact' },
    { id: otherUserId, email: TEST_PREFIX + 'other@test.com', name: TEST_PREFIX + 'Other' },
  ]);

  // Create user profiles (needed for ghost user flows)
  await db.insert(userProfiles).values([
    { userId: ownerUserId },
    { userId: contactUserId },
  ]);

  // Create a regular index for comparison
  const regularIndexId = crypto.randomUUID();
  await db.insert(networks).values({
    id: regularIndexId,
    title: TEST_PREFIX + 'Regular Index',
    prompt: 'A regular community index',
  });
  await db.insert(networkMembers).values({
    networkId: regularIndexId,
    userId: ownerUserId,
    permissions: ['owner'],
    autoAssign: false,
  });

  // Create a contact intent (for testing intent backfill)
  const contactIntentId = crypto.randomUUID();
  await db.insert(intents).values({
    id: contactIntentId,
    userId: contactUserId,
    payload: TEST_PREFIX + 'I am looking for collaborators',
    sourceType: 'discovery_form',
    status: 'ACTIVE',
  });

  // Use ensurePersonalIndex to create the owner's personal index
  const personalIndexId = await ensurePersonalIndex(ownerUserId);

  fixture = {
    ownerUserId,
    contactUserId,
    otherUserId,
    personalIndexId,
    regularIndexId,
    contactIntentId,
    extraIntentIndexIds: [],
    extraMemberIndexIds: [],
  };
});

afterAll(async () => {
  if (!fixture) return;

  const allUserIds = [fixture.ownerUserId, fixture.contactUserId, fixture.otherUserId];
  const allIndexIds = [fixture.personalIndexId, fixture.regularIndexId];

  // Cleanup in reverse FK order
  await db.delete(intentNetworks).where(
    inArray(intentNetworks.networkId, allIndexIds),
  );
  await db.delete(networkMembers).where(
    inArray(networkMembers.networkId, allIndexIds),
  );
  await db.delete(intents).where(
    inArray(intents.userId, allUserIds),
  );
  await db.delete(personalNetworks).where(
    inArray(personalNetworks.userId, allUserIds),
  );
  await db.delete(networks).where(
    inArray(networks.id, allIndexIds),
  );
  await db.delete(userProfiles).where(
    inArray(userProfiles.userId, allUserIds),
  );
  await db.delete(users).where(
    inArray(users.id, allUserIds),
  );
});

// ─── ensurePersonalIndex ────────────────────────────────────────────────────────

describe('ensurePersonalIndex', () => {
  it('creates a personal index with correct title and personal_indexes entry', async () => {
    const [row] = await db
      .select()
      .from(networks)
      .where(eq(networks.id, fixture.personalIndexId));

    expect(row).toBeDefined();
    expect(row.title).toBe('My Network');
    expect(row.isPersonal).toBe(true);

    // Verify personal_indexes mapping
    const [mapping] = await db
      .select()
      .from(personalNetworks)
      .where(eq(personalNetworks.userId, fixture.ownerUserId));

    expect(mapping).toBeDefined();
    expect(mapping.networkId).toBe(fixture.personalIndexId);
  });

  it('creates an owner membership with ["owner"] permissions', async () => {
    const [membership] = await db
      .select()
      .from(networkMembers)
      .where(
        and(
          eq(networkMembers.networkId, fixture.personalIndexId),
          eq(networkMembers.userId, fixture.ownerUserId),
        ),
      );

    expect(membership).toBeDefined();
    expect(membership.permissions).toEqual(['owner']);
  });

  it('creates owner membership with autoAssign enabled', async () => {
    const [membership] = await db
      .select()
      .from(networkMembers)
      .where(
        and(
          eq(networkMembers.networkId, fixture.personalIndexId),
          eq(networkMembers.userId, fixture.ownerUserId),
        ),
      );

    expect(membership).toBeDefined();
    expect(membership.autoAssign).toBe(true);
  });

  it('is idempotent — calling twice returns the same index ID', async () => {
    const secondCall = await ensurePersonalIndex(fixture.ownerUserId);
    expect(secondCall).toBe(fixture.personalIndexId);

    // Verify only one personal index exists for this user
    const rows = await db
      .select({ networkId: personalNetworks.networkId })
      .from(personalNetworks)
      .where(eq(personalNetworks.userId, fixture.ownerUserId));
    expect(rows).toHaveLength(1);
  });
});

// ─── getPersonalIndexId ─────────────────────────────────────────────────────────

describe('getPersonalIndexId', () => {
  it('returns the correct index ID for a user with a personal index', async () => {
    const result = await getPersonalIndexId(fixture.ownerUserId);
    expect(result).toBe(fixture.personalIndexId);
  });

  it('returns null for a user without a personal index', async () => {
    const result = await getPersonalIndexId(fixture.otherUserId);
    expect(result).toBeNull();
  });
});

// ─── getPersonalIndexesForContact ───────────────────────────────────────────────

describe('getPersonalIndexesForContact', () => {
  const chatDb = new ChatDatabaseAdapter();

  it('returns empty array when user is not a contact in any personal index', async () => {
    const result = await chatDb.getPersonalIndexesForContact(fixture.otherUserId);
    expect(result).toEqual([]);
  });

  it('returns personal indexes where user is a contact member', async () => {
    // Manually add the contact user as a contact member
    await db.insert(networkMembers).values({
      networkId: fixture.personalIndexId,
      userId: fixture.contactUserId,
      permissions: ['contact'],
      autoAssign: false,
    }).onConflictDoNothing();

    const result = await chatDb.getPersonalIndexesForContact(fixture.contactUserId);
    expect(result.length).toBeGreaterThanOrEqual(1);
    expect(result.some(r => r.networkId === fixture.personalIndexId)).toBe(true);
  });
});

// ─── upsertContactMembership → personal index sync ─────────────────────────────

describe('upsertContactMembership → personal index sync', () => {
  const chatDb = new ChatDatabaseAdapter();

  it('creates index_members entry with contact permissions for new contacts', async () => {
    // Remove the manually-added contact member from previous test
    await db.delete(networkMembers).where(
      and(
        eq(networkMembers.networkId, fixture.personalIndexId),
        eq(networkMembers.userId, fixture.contactUserId),
      ),
    );

    await chatDb.upsertContactMembership(fixture.ownerUserId, fixture.contactUserId);

    // Verify contact was added as member with ['contact'] permissions
    const [membership] = await db
      .select()
      .from(networkMembers)
      .where(
        and(
          eq(networkMembers.networkId, fixture.personalIndexId),
          eq(networkMembers.userId, fixture.contactUserId),
        ),
      );
    expect(membership).toBeDefined();
    expect(membership.permissions).toEqual(['contact']);
  });
});

// ─── Contact removal → cleanup ──────────────────────────────────────────────────

describe('hardDeleteContactMembership → personal index cleanup', () => {
  const chatDb = new ChatDatabaseAdapter();

  it('removes contact membership from personal index', async () => {
    await chatDb.hardDeleteContactMembership(fixture.ownerUserId, fixture.contactUserId);

    // Contact's membership should be removed
    const memberships = await db
      .select()
      .from(networkMembers)
      .where(
        and(
          eq(networkMembers.networkId, fixture.personalIndexId),
          eq(networkMembers.userId, fixture.contactUserId),
        ),
      );
    expect(memberships).toHaveLength(0);
  });
});

// ─── getIndexMemberships ────────────────────────────────────────────────────────

describe('getIndexMemberships', () => {
  const chatDb = new ChatDatabaseAdapter();

  it('returns the user\'s own personal index', async () => {
    const memberships = await chatDb.getIndexMemberships(fixture.ownerUserId);

    const personalMembership = memberships.find(m => m.networkId === fixture.personalIndexId);
    expect(personalMembership).toBeDefined();
    expect(personalMembership!.permissions).toEqual(['owner']);
  });

  it('returns regular indexes the user is a member of', async () => {
    const memberships = await chatDb.getIndexMemberships(fixture.ownerUserId);

    const regularMembership = memberships.find(m => m.networkId === fixture.regularIndexId);
    expect(regularMembership).toBeDefined();
  });

  it('does NOT return other users\' personal indexes the user is a contact in', async () => {
    // Re-add contact as member of owner's personal index
    await db.insert(networkMembers).values({
      networkId: fixture.personalIndexId,
      userId: fixture.contactUserId,
      permissions: ['contact'],
      autoAssign: false,
    }).onConflictDoNothing();

    // Contact's memberships should NOT include the owner's personal index
    const memberships = await chatDb.getIndexMemberships(fixture.contactUserId);
    const ownerPersonalIndex = memberships.find(m => m.networkId === fixture.personalIndexId);
    expect(ownerPersonalIndex).toBeUndefined();
  });
});

// ─── isPersonalIndex ────────────────────────────────────────────────────────────

describe('isPersonalIndex', () => {
  const chatDb = new ChatDatabaseAdapter();

  it('returns true for a personal index', async () => {
    const result = await chatDb.isPersonalIndex(fixture.personalIndexId);
    expect(result).toBe(true);
  });

  it('returns false for a regular index', async () => {
    const result = await chatDb.isPersonalIndex(fixture.regularIndexId);
    expect(result).toBe(false);
  });

  it('returns false for a non-existent index', async () => {
    const result = await chatDb.isPersonalIndex(crypto.randomUUID());
    expect(result).toBe(false);
  });
});

// ─── NetworkService assertNotPersonal guard ───────────────────────────────────────

describe('NetworkService personal index guards', () => {
  const service = new NetworkService();

  it('rejects updateIndex on a personal index', async () => {
    await expect(
      service.updateIndex(fixture.personalIndexId, fixture.ownerUserId, { title: 'New Title' }),
    ).rejects.toThrow('personal indexes cannot be modified directly');
  });

  it('rejects deleteIndex on a personal index', async () => {
    await expect(
      service.deleteIndex(fixture.personalIndexId, fixture.ownerUserId),
    ).rejects.toThrow('personal indexes cannot be modified directly');
  });

  it('allows updateIndex on a regular index', async () => {
    // Should not throw (may fail for other reasons like permissions, but not the personal guard)
    try {
      await service.updateIndex(fixture.regularIndexId, fixture.ownerUserId, { title: TEST_PREFIX + 'Updated' });
    } catch (error: unknown) {
      // Only fail if the error is about personal indexes
      if (error instanceof Error && error.message.includes('personal indexes')) {
        throw error;
      }
      // Other errors (e.g. missing permissions check) are acceptable here
    }
  });
});
