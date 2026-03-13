/**
 * Smoke tests for ContactService — the core of the My Network feature.
 * Exercises the full flow: import contacts, ghost user creation, listing,
 * adding, removing, self-link prevention, deduplication, and ghost claim.
 *
 * Requires DATABASE_URL and migrated schema.
 * Run: bun test src/services/tests/contact.service.spec.ts
 */
import { config } from 'dotenv';
config({ path: '.env.test', override: true });

import { describe, expect, it, beforeAll, afterAll } from 'bun:test';
import { eq, inArray } from 'drizzle-orm';
import db from '../../lib/drizzle/drizzle';
import {
  users,
  userProfiles,
  userContacts,
  indexes,
  indexMembers,
} from '../../schemas/database.schema';
import { ContactService } from '../contact.service';
import { AuthDatabaseAdapter } from '../../adapters/auth.adapter';

const TEST_PREFIX = 'contact_svc_smoke_' + Date.now() + '_';

// -- Test fixtures --
let ownerId: string;
let existingUserId: string;
let personalIndexId: string;

const ownerEmail = `${TEST_PREFIX}owner@test.com`;
const existingContactEmail = `${TEST_PREFIX}existing@test.com`;
const ghostEmail1 = `${TEST_PREFIX}ghost1@test.com`;
const ghostEmail2 = `${TEST_PREFIX}ghost2@test.com`;

// Track IDs for cleanup
const createdGhostIds: string[] = [];

const svc = new ContactService();
const authDb = new AuthDatabaseAdapter();

beforeAll(async () => {
  ownerId = crypto.randomUUID();
  existingUserId = crypto.randomUUID();

  // Create owner user
  await db.insert(users).values({
    id: ownerId,
    name: TEST_PREFIX + 'Owner',
    email: ownerEmail,
  });
  await db.insert(userProfiles).values({ userId: ownerId });

  // Create an existing (non-ghost) user that one contact will match
  await db.insert(users).values({
    id: existingUserId,
    name: TEST_PREFIX + 'ExistingContact',
    email: existingContactEmail,
  });

  // Create owner's personal index
  const { ensurePersonalIndex } = await import('../../adapters/database.adapter');
  personalIndexId = await ensurePersonalIndex(ownerId);
});

afterAll(async () => {
  // Clean up in dependency order: contacts → index_members → profiles → indexes → users
  await db.delete(userContacts).where(eq(userContacts.ownerId, ownerId));
  const allUserIds = [ownerId, existingUserId, ...createdGhostIds];
  await db.delete(indexMembers).where(inArray(indexMembers.userId, allUserIds));
  await db.delete(userProfiles).where(inArray(userProfiles.userId, allUserIds));
  await db.delete(indexes).where(eq(indexes.id, personalIndexId));
  await db.delete(users).where(inArray(users.id, allUserIds));
});

// ═══════════════════════════════════════════════════════════════════════════════
// 1. Import contacts — mixed existing + ghost
// ═══════════════════════════════════════════════════════════════════════════════
describe('importContacts', () => {
  it('imports contacts: links existing user, creates ghosts for unknown emails', async () => {
    const result = await svc.importContacts(
      ownerId,
      [
        { name: 'Existing Person', email: existingContactEmail },
        { name: 'Ghost One', email: ghostEmail1 },
        { name: 'Ghost Two', email: ghostEmail2 },
      ],
      'manual'
    );

    expect(result.imported).toBe(3);
    expect(result.newContacts).toBe(3);
    expect(result.skipped).toBe(0);

    // Track ghost IDs for cleanup
    for (const d of result.details) {
      if (d.isNew) createdGhostIds.push(d.userId);
    }

    // Verify existing user linked (not a ghost)
    const existingDetail = result.details.find(d => d.email === existingContactEmail);
    expect(existingDetail).toBeDefined();
    expect(existingDetail!.userId).toBe(existingUserId);
    expect(existingDetail!.isNew).toBe(false);

    // Verify ghosts created
    const ghost1Detail = result.details.find(d => d.email === ghostEmail1);
    expect(ghost1Detail).toBeDefined();
    expect(ghost1Detail!.isNew).toBe(true);

    // Verify ghost row in DB
    const [ghostRow] = await db
      .select({ isGhost: users.isGhost, name: users.name })
      .from(users)
      .where(eq(users.id, ghost1Detail!.userId));
    expect(ghostRow.isGhost).toBe(true);
    expect(ghostRow.name).toBe('Ghost One');
  });

  it('creates profile for ghost users', async () => {
    const ghostId = createdGhostIds[0];
    expect(ghostId).toBeDefined();

    const [profile] = await db
      .select()
      .from(userProfiles)
      .where(eq(userProfiles.userId, ghostId));
    expect(profile).toBeDefined();
    expect(profile.userId).toBe(ghostId);
  });

  it('adds contacts to the owner personal index as members', async () => {
    const ghostId = createdGhostIds[0];
    const memberships = await db
      .select()
      .from(indexMembers)
      .where(eq(indexMembers.userId, ghostId));
    expect(memberships.some(m => m.indexId === personalIndexId)).toBe(true);
  });

  it('skips self-import (owner email)', async () => {
    const result = await svc.importContacts(
      ownerId,
      [{ name: 'Me', email: ownerEmail }],
      'manual'
    );
    expect(result.imported).toBe(0);
    expect(result.skipped).toBe(1);
  });

  it('skips invalid emails', async () => {
    const result = await svc.importContacts(
      ownerId,
      [
        { name: 'No At', email: 'not-an-email' },
        { name: 'Empty', email: '' },
        { name: 'Blank', email: '   ' },
      ],
      'manual'
    );
    expect(result.imported).toBe(0);
    expect(result.skipped).toBe(3);
  });

  it('deduplicates contacts within the same batch', async () => {
    const uniqueEmail = `${TEST_PREFIX}dedup@test.com`;
    const result = await svc.importContacts(
      ownerId,
      [
        { name: 'First', email: uniqueEmail },
        { name: 'Duplicate', email: uniqueEmail },
      ],
      'manual'
    );
    expect(result.imported).toBe(1);
    expect(result.skipped).toBe(1);
    // cleanup
    for (const d of result.details) {
      if (d.isNew) createdGhostIds.push(d.userId);
    }
  });

  it('is idempotent — re-importing same contacts does not duplicate', async () => {
    const result = await svc.importContacts(
      ownerId,
      [
        { name: 'Existing Person', email: existingContactEmail },
        { name: 'Ghost One', email: ghostEmail1 },
      ],
      'manual'
    );
    // All contacts already exist, so no new contacts
    expect(result.newContacts).toBe(0);
    expect(result.imported).toBe(2);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 2. List contacts
// ═══════════════════════════════════════════════════════════════════════════════
describe('listContacts', () => {
  it('returns all contacts with user details', async () => {
    const contacts = await svc.listContacts(ownerId);
    expect(contacts.length).toBeGreaterThanOrEqual(3);

    const existing = contacts.find(c => c.userId === existingUserId);
    expect(existing).toBeDefined();
    expect(existing!.user.isGhost).toBe(false);
    expect(existing!.source).toBe('manual');

    const ghost = contacts.find(c => c.user.isGhost === true);
    expect(ghost).toBeDefined();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 3. Add single contact
// ═══════════════════════════════════════════════════════════════════════════════
describe('addContact', () => {
  const singleEmail = `${TEST_PREFIX}single@test.com`;

  it('adds a single contact by email', async () => {
    const result = await svc.addContact(ownerId, singleEmail, 'Single Contact');
    expect(result.imported).toBe(1);
    expect(result.newContacts).toBe(1);
    for (const d of result.details) {
      if (d.isNew) createdGhostIds.push(d.userId);
    }
  });

  it('appears in contact list after adding', async () => {
    const contacts = await svc.listContacts(ownerId);
    const found = contacts.find(c => c.user.email === singleEmail);
    expect(found).toBeDefined();
    expect(found!.user.name).toBe('Single Contact');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 4. Remove contact (soft delete)
// ═══════════════════════════════════════════════════════════════════════════════
describe('removeContact', () => {
  it('soft-deletes a contact and it no longer appears in list', async () => {
    const contacts = await svc.listContacts(ownerId);
    const target = contacts.find(c => c.userId === existingUserId);
    expect(target).toBeDefined();

    await svc.removeContact(ownerId, target!.id);

    const after = await svc.listContacts(ownerId);
    const removed = after.find(c => c.id === target!.id);
    expect(removed).toBeUndefined();
  });

  it('re-importing a removed contact reactivates it', async () => {
    const result = await svc.importContacts(
      ownerId,
      [{ name: 'Existing Person', email: existingContactEmail }],
      'manual'
    );
    expect(result.imported).toBe(1);

    const contacts = await svc.listContacts(ownerId);
    const reactivated = contacts.find(c => c.userId === existingUserId);
    expect(reactivated).toBeDefined();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 5. Second owner imports existing ghost — no duplicate ghost created
// ═══════════════════════════════════════════════════════════════════════════════
describe('second owner imports existing ghost', () => {
  const secondOwnerId = crypto.randomUUID();
  const secondOwnerEmail = `${TEST_PREFIX}owner2@test.com`;

  beforeAll(async () => {
    await db.insert(users).values({
      id: secondOwnerId,
      name: TEST_PREFIX + 'Owner2',
      email: secondOwnerEmail,
    });
    await db.insert(userProfiles).values({ userId: secondOwnerId });
  });

  afterAll(async () => {
    await db.delete(userContacts).where(eq(userContacts.ownerId, secondOwnerId));
    await db.delete(userProfiles).where(eq(userProfiles.userId, secondOwnerId));
    await db.delete(users).where(eq(users.id, secondOwnerId));
  });

  it('reuses existing ghost user instead of creating a duplicate', async () => {
    // ghostEmail1 already has a ghost from section 1
    const result = await svc.importContacts(
      secondOwnerId,
      [{ name: 'Ghost One Again', email: ghostEmail1 }],
      'manual'
    );

    expect(result.imported).toBe(1);
    // The ghost user already exists in the users table, so isNew is false
    expect(result.details[0].isNew).toBe(false);

    // Verify only one user row exists for this email (no duplicate)
    const rows = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, ghostEmail1));
    expect(rows.length).toBe(1);

    // Second owner's contact points to the same ghost user as first owner's
    const firstOwnerContacts = await svc.listContacts(ownerId);
    const secondOwnerContacts = await svc.listContacts(secondOwnerId);
    const ghost1ForOwner1 = firstOwnerContacts.find(c => c.user.email === ghostEmail1);
    const ghost1ForOwner2 = secondOwnerContacts.find(c => c.user.email === ghostEmail1);
    expect(ghost1ForOwner1).toBeDefined();
    expect(ghost1ForOwner2).toBeDefined();
    expect(ghost1ForOwner1!.userId).toBe(ghost1ForOwner2!.userId);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 6. Signup auto-claims ghost (simulates Better Auth hook)
// ═══════════════════════════════════════════════════════════════════════════════
describe('signup auto-claims ghost user', () => {
  const signupEmail = `${TEST_PREFIX}signup@test.com`;
  const realUserId = crypto.randomUUID();
  let ghostId: string;

  beforeAll(async () => {
    // Create a ghost via contact import
    const result = await svc.addContact(ownerId, signupEmail, 'Future Signup');
    ghostId = result.details[0].userId;
    createdGhostIds.push(ghostId);
  });

  afterAll(async () => {
    await db.delete(userContacts).where(eq(userContacts.userId, realUserId));
    await db.delete(userProfiles).where(eq(userProfiles.userId, realUserId));
    await db.delete(indexMembers).where(eq(indexMembers.userId, realUserId));
    await db.delete(users).where(eq(users.id, realUserId));
    // Ghost is deleted by claim, remove from cleanup list
    const idx = createdGhostIds.indexOf(ghostId);
    if (idx >= 0) createdGhostIds.splice(idx, 1);
  });

  it('ghost exists before signup', async () => {
    const [row] = await db
      .select({ isGhost: users.isGhost })
      .from(users)
      .where(eq(users.id, ghostId));
    expect(row.isGhost).toBe(true);
  });

  it('signup with ghost email claims the ghost automatically', async () => {
    // Simulate Better Auth create.before hook: free the ghost email
    const claimedGhostId = await authDb.prepareGhostClaim(signupEmail);
    expect(claimedGhostId).toBe(ghostId);

    // Simulate Better Auth inserting the real user
    await db.insert(users).values({
      id: realUserId,
      name: TEST_PREFIX + 'SignupUser',
      email: signupEmail,
    });

    // Simulate Better Auth create.after hook: claim ghost data
    await authDb.claimGhostUser(realUserId, claimedGhostId!);

    // Ghost row is gone
    const ghostRows = await db
      .select()
      .from(users)
      .where(eq(users.id, ghostId));
    expect(ghostRows.length).toBe(0);

    // Real user exists and is not a ghost
    const [realUser] = await db
      .select({ id: users.id, isGhost: users.isGhost, email: users.email })
      .from(users)
      .where(eq(users.id, realUserId));
    expect(realUser.isGhost).toBe(false);
    expect(realUser.email).toBe(signupEmail);

    // Contact relationship transferred: owner's contact now points to the real user
    const contacts = await svc.listContacts(ownerId);
    const claimed = contacts.find(c => c.userId === realUserId);
    expect(claimed).toBeDefined();
    expect(claimed!.user.isGhost).toBe(false);
    expect(claimed!.user.email).toBe(signupEmail);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 7. Ghost claim (two-phase: prepareGhostClaim + claimGhostUser)
// ═══════════════════════════════════════════════════════════════════════════════
describe('ghost claim flow', () => {
  let claimGhostId: string;
  const claimEmail = `${TEST_PREFIX}claim@test.com`;
  const realUserId = crypto.randomUUID();

  beforeAll(async () => {
    // Import a contact to create a ghost
    const result = await svc.addContact(ownerId, claimEmail, 'Claim Target');
    claimGhostId = result.details[0].userId;
    createdGhostIds.push(claimGhostId);
  });

  afterAll(async () => {
    // Clean up the real user created during claim
    await db.delete(userContacts).where(eq(userContacts.userId, realUserId));
    await db.delete(userProfiles).where(eq(userProfiles.userId, realUserId));
    await db.delete(indexMembers).where(eq(indexMembers.userId, realUserId));
    await db.delete(users).where(eq(users.id, realUserId));
    // Remove ghost from cleanup list since claim deletes it
    const idx = createdGhostIds.indexOf(claimGhostId);
    if (idx >= 0) createdGhostIds.splice(idx, 1);
  });

  it('prepareGhostClaim frees the ghost email', async () => {
    const ghostId = await authDb.prepareGhostClaim(claimEmail);
    expect(ghostId).toBe(claimGhostId);

    // Ghost email is now a placeholder
    const [ghost] = await db
      .select({ email: users.email })
      .from(users)
      .where(eq(users.id, claimGhostId));
    expect(ghost.email).toBe(`__ghost_claimed_${claimGhostId}`);
  });

  it('real user can be created with the freed email', async () => {
    await db.insert(users).values({
      id: realUserId,
      name: TEST_PREFIX + 'RealClaimer',
      email: claimEmail,
    });
    const [row] = await db
      .select({ email: users.email })
      .from(users)
      .where(eq(users.id, realUserId));
    expect(row.email).toBe(claimEmail);
  });

  it('claimGhostUser transfers data and deletes ghost', async () => {
    await authDb.claimGhostUser(realUserId, claimGhostId);

    // Ghost row gone
    const ghosts = await db
      .select()
      .from(users)
      .where(eq(users.id, claimGhostId));
    expect(ghosts.length).toBe(0);

    // Contact ownership transferred
    const contacts = await db
      .select()
      .from(userContacts)
      .where(eq(userContacts.userId, realUserId));
    expect(contacts.length).toBeGreaterThanOrEqual(1);

    // Profile transferred
    const profiles = await db
      .select()
      .from(userProfiles)
      .where(eq(userProfiles.userId, realUserId));
    expect(profiles.length).toBe(1);
  });

  it('contact list reflects the claimed user', async () => {
    const contacts = await svc.listContacts(ownerId);
    const claimed = contacts.find(c => c.userId === realUserId);
    expect(claimed).toBeDefined();
    expect(claimed!.user.isGhost).toBe(false);
  });
});
