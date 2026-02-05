/*
  Discovery Integration Tests
  
  Tests the actual discovery logic with real database operations.
  
  Requirements:
  - Database connection (set DATABASE_URL)
  - Clean test data (will create/cleanup test records)

  Usage:
    DATABASE_URL=postgres://... TS_NODE_TRANSPILE_ONLY=1 node -r ts-node/register ./tests/discovery.test.ts
*/

import dotenv from 'dotenv';
import path from 'path';

// Load environment-specific .env file first
const envFile = `.env.${process.env.NODE_ENV || 'development'}`;
dotenv.config({ path: path.resolve(process.cwd(), envFile) });

console.log('process.env', process.env);

import { v4 as uuidv4 } from 'uuid';
import db from '../src/lib/drizzle/drizzle';
import { 
  users, 
  indexes, 
  intents, 
  indexMembers, 
  intentIndexes, 
  intentStakes, 
  intentStakeItems,
  userConnectionEvents,
  agents
} from '../src/schemas/database.schema';
import { discoverUsers } from '../src/lib/discover';
import { eq, inArray } from 'drizzle-orm';

// ============================================================================
// TEST UTILITIES
// ============================================================================

const TEST_PREFIX = 'test_discovery_';
const createdIds: {
  users: string[];
  indexes: string[];
  intents: string[];
  stakes: string[];
  agents: string[];
} = {
  users: [],
  indexes: [],
  intents: [],
  stakes: [],
  agents: [],
};

async function createTestUser(name: string): Promise<string> {
  const id = uuidv4();
  await db.insert(users).values({
    id,
    privyId: `${TEST_PREFIX}${id}`,
    name: `${TEST_PREFIX}${name}`,
    email: `${TEST_PREFIX}${id}@test.com`,
  });
  createdIds.users.push(id);
  return id;
}

async function createTestIndex(title: string): Promise<string> {
  const id = uuidv4();
  await db.insert(indexes).values({
    id,
    title: `${TEST_PREFIX}${title}`,
  });
  createdIds.indexes.push(id);
  return id;
}

async function createTestIntent(userId: string, payload: string): Promise<string> {
  const id = uuidv4();
  await db.insert(intents).values({
    id,
    userId,
    payload: `${TEST_PREFIX}${payload}`,
  });
  createdIds.intents.push(id);
  return id;
}

async function addMember(userId: string, indexId: string): Promise<void> {
  await db.insert(indexMembers).values({
    userId,
    indexId,
    permissions: [],
  }).onConflictDoNothing();
}

async function assignIntentToIndex(intentId: string, indexId: string): Promise<void> {
  await db.insert(intentIndexes).values({
    intentId,
    indexId,
  }).onConflictDoNothing();
}

async function createTestAgent(): Promise<string> {
  const id = uuidv4();
  await db.insert(agents).values({
    id,
    name: `${TEST_PREFIX}agent`,
    description: 'Test agent for discovery tests',
    avatar: 'test.png',
  });
  createdIds.agents.push(id);
  return id;
}

async function createTestStake(intentIds: string[], stake: number, reasoning: string, agentId: string): Promise<string> {
  const id = uuidv4();
  await db.insert(intentStakes).values({
    id,
    intents: intentIds,
    stake: BigInt(stake),
    reasoning,
    agentId,
  });
  createdIds.stakes.push(id);
  
  // Also populate intent_stake_items for fast lookups
  for (const intentId of intentIds) {
    const intent = await db.select({ userId: intents.userId }).from(intents).where(eq(intents.id, intentId));
    if (intent[0]) {
      await db.insert(intentStakeItems).values({
        stakeId: id,
        intentId,
        userId: intent[0].userId,
      });
    }
  }
  
  return id;
}

async function createConnection(userA: string, userB: string): Promise<void> {
  await db.insert(userConnectionEvents).values({
    initiatorUserId: userA,
    receiverUserId: userB,
    eventType: 'REQUEST',
  });
}

async function cleanup(includeAgents = false): Promise<void> {
  // Delete in reverse dependency order
  if (createdIds.stakes.length > 0) {
    await db.delete(intentStakeItems).where(inArray(intentStakeItems.stakeId, createdIds.stakes));
    await db.delete(intentStakes).where(inArray(intentStakes.id, createdIds.stakes));
  }
  if (createdIds.intents.length > 0) {
    await db.delete(intentIndexes).where(inArray(intentIndexes.intentId, createdIds.intents));
    await db.delete(intents).where(inArray(intents.id, createdIds.intents));
  }
  if (createdIds.indexes.length > 0) {
    await db.delete(indexMembers).where(inArray(indexMembers.indexId, createdIds.indexes));
    await db.delete(indexes).where(inArray(indexes.id, createdIds.indexes));
  }
  if (createdIds.users.length > 0) {
    await db.delete(userConnectionEvents).where(inArray(userConnectionEvents.initiatorUserId, createdIds.users));
    await db.delete(userConnectionEvents).where(inArray(userConnectionEvents.receiverUserId, createdIds.users));
    await db.delete(users).where(inArray(users.id, createdIds.users));
  }
  if (includeAgents && createdIds.agents.length > 0) {
    await db.delete(agents).where(inArray(agents.id, createdIds.agents));
    createdIds.agents = [];
  }
  
  // Reset tracking (except agents)
  createdIds.users = [];
  createdIds.indexes = [];
  createdIds.intents = [];
  createdIds.stakes = [];
}

// ============================================================================
// TEST RUNNER
// ============================================================================

interface TestResult {
  name: string;
  passed: boolean;
  error?: string;
}

const results: TestResult[] = [];

async function test(name: string, fn: () => Promise<void>) {
  try {
    await fn();
    results.push({ name, passed: true });
    console.log(`✅ PASS: ${name}`);
  } catch (e: any) {
    results.push({ name, passed: false, error: e.message });
    console.log(`❌ FAIL: ${name}`);
    console.log(`   Error: ${e.message}`);
  } finally {
    await cleanup(false); // Don't delete agents between tests
  }
}

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

function assertLength(arr: any[], expected: number, message?: string) {
  if (arr.length !== expected) {
    throw new Error(message || `Expected length ${expected}, got ${arr.length}`);
  }
}

function assertContainsUser(results: any[], userId: string, message?: string) {
  const found = results.some(r => r.user.id === userId);
  if (!found) throw new Error(message || `Expected results to contain user ${userId}`);
}

function assertNotContainsUser(results: any[], userId: string, message?: string) {
  const found = results.some(r => r.user.id === userId);
  if (found) throw new Error(message || `Expected results NOT to contain user ${userId}`);
}

// ============================================================================
// TEST CASES
// ============================================================================

async function runTests() {
  console.log('\n🧪 Discovery Integration Tests\n');
  console.log('='.repeat(60));

  const agentId = await createTestAgent();

  // -------------------------------------------------------------------------
  // TEST 1: Basic Match
  // -------------------------------------------------------------------------
  await test('discovers user when both share same index and intents are staked', async () => {
    const userA = await createTestUser('User A');
    const userB = await createTestUser('User B');
    const index1 = await createTestIndex('Index 1');

    const intentA = await createTestIntent(userA, 'Looking for collaborators');
    const intentB = await createTestIntent(userB, 'Want to collaborate');

    await addMember(userA, index1);
    await addMember(userB, index1);
    await assignIntentToIndex(intentA, index1);
    await assignIntentToIndex(intentB, index1);
    await createTestStake([intentA, intentB], 100, 'Both want to collaborate', agentId);

    const { results: discovered } = await discoverUsers({ authenticatedUserId: userA });

    assertLength(discovered, 1, 'Should discover exactly 1 user');
    assertContainsUser(discovered, userB, 'Should discover User B');
  });

  // -------------------------------------------------------------------------
  // TEST 2: No Shared Index
  // -------------------------------------------------------------------------
  await test('returns empty when users are in different indexes with no overlap', async () => {
    const userA = await createTestUser('User A');
    const userB = await createTestUser('User B');
    const index1 = await createTestIndex('Index 1');
    const index2 = await createTestIndex('Index 2');

    const intentA = await createTestIntent(userA, 'Looking for collaborators');
    const intentB = await createTestIntent(userB, 'Want to collaborate');

    await addMember(userA, index1);
    await addMember(userB, index2);
    await assignIntentToIndex(intentA, index1);
    await assignIntentToIndex(intentB, index2);
    await createTestStake([intentA, intentB], 100, 'Match', agentId);

    const { results: discovered } = await discoverUsers({ authenticatedUserId: userA });

    assertLength(discovered, 0, 'Should discover no users (no shared index)');
  });

  // -------------------------------------------------------------------------
  // TEST 3: Intent in Wrong Index
  // -------------------------------------------------------------------------
  await test('returns empty when users share indexes but intents are assigned to different indexes', async () => {
    const userA = await createTestUser('User A');
    const userB = await createTestUser('User B');
    const index1 = await createTestIndex('Index 1');
    const index2 = await createTestIndex('Index 2');

    const intentA = await createTestIntent(userA, 'Looking for collaborators');
    const intentB = await createTestIntent(userB, 'Want to collaborate');

    await addMember(userA, index1);
    await addMember(userA, index2);
    await addMember(userB, index1);
    await addMember(userB, index2);
    await assignIntentToIndex(intentA, index1);
    await assignIntentToIndex(intentB, index2); // Different index!
    await createTestStake([intentA, intentB], 100, 'Match', agentId);

    const { results: discovered } = await discoverUsers({ authenticatedUserId: userA });

    assertLength(discovered, 0, 'Should discover no users (intents not in same index)');
  });

  // -------------------------------------------------------------------------
  // TEST 4: No Stake
  // -------------------------------------------------------------------------
  await test('returns empty when no stake connects the intents', async () => {
    const userA = await createTestUser('User A');
    const userB = await createTestUser('User B');
    const index1 = await createTestIndex('Index 1');

    const intentA = await createTestIntent(userA, 'Looking for collaborators');
    const intentB = await createTestIntent(userB, 'Want to collaborate');

    await addMember(userA, index1);
    await addMember(userB, index1);
    await assignIntentToIndex(intentA, index1);
    await assignIntentToIndex(intentB, index1);
    // No stake created!

    const { results: discovered } = await discoverUsers({ authenticatedUserId: userA });

    assertLength(discovered, 0, 'Should discover no users (no stake)');
  });

  // -------------------------------------------------------------------------
  // TEST 5: Already Connected (excluded)
  // -------------------------------------------------------------------------
  await test('excludes already connected users by default', async () => {
    const userA = await createTestUser('User A');
    const userB = await createTestUser('User B');
    const index1 = await createTestIndex('Index 1');

    const intentA = await createTestIntent(userA, 'Looking for collaborators');
    const intentB = await createTestIntent(userB, 'Want to collaborate');

    await addMember(userA, index1);
    await addMember(userB, index1);
    await assignIntentToIndex(intentA, index1);
    await assignIntentToIndex(intentB, index1);
    await createTestStake([intentA, intentB], 100, 'Match', agentId);
    await createConnection(userA, userB);

    const { results: discovered } = await discoverUsers({ 
      authenticatedUserId: userA,
      excludeDiscovered: true 
    });

    assertLength(discovered, 0, 'Should discover no users (already connected)');
  });

  // -------------------------------------------------------------------------
  // TEST 6: Already Connected but excludeDiscovered=false
  // -------------------------------------------------------------------------
  await test('includes already connected users when excludeDiscovered is false', async () => {
    const userA = await createTestUser('User A');
    const userB = await createTestUser('User B');
    const index1 = await createTestIndex('Index 1');

    const intentA = await createTestIntent(userA, 'Looking for collaborators');
    const intentB = await createTestIntent(userB, 'Want to collaborate');

    await addMember(userA, index1);
    await addMember(userB, index1);
    await assignIntentToIndex(intentA, index1);
    await assignIntentToIndex(intentB, index1);
    await createTestStake([intentA, intentB], 100, 'Match', agentId);
    await createConnection(userA, userB);

    const { results: discovered } = await discoverUsers({ 
      authenticatedUserId: userA,
      excludeDiscovered: false 
    });

    assertLength(discovered, 1, 'Should discover 1 user when excludeDiscovered=false');
    assertContainsUser(discovered, userB, 'Should discover User B');
  });

  // -------------------------------------------------------------------------
  // TEST 7: Multi-User Stake
  // -------------------------------------------------------------------------
  await test('discovers multiple users from a single stake with 3+ participants', async () => {
    const userA = await createTestUser('User A');
    const userB = await createTestUser('User B');
    const userC = await createTestUser('User C');
    const index1 = await createTestIndex('Index 1');

    const intentA = await createTestIntent(userA, 'Intent A');
    const intentB = await createTestIntent(userB, 'Intent B');
    const intentC = await createTestIntent(userC, 'Intent C');

    await addMember(userA, index1);
    await addMember(userB, index1);
    await addMember(userC, index1);
    await assignIntentToIndex(intentA, index1);
    await assignIntentToIndex(intentB, index1);
    await assignIntentToIndex(intentC, index1);
    await createTestStake([intentA, intentB, intentC], 100, 'All match', agentId);

    const { results: discovered } = await discoverUsers({ authenticatedUserId: userA });

    assertLength(discovered, 2, 'Should discover 2 users');
    assertContainsUser(discovered, userB, 'Should discover User B');
    assertContainsUser(discovered, userC, 'Should discover User C');
  });

  // -------------------------------------------------------------------------
  // TEST 8: Index Filter
  // -------------------------------------------------------------------------
  await test('filters results to only specified indexIds', async () => {
    const userA = await createTestUser('User A');
    const userB = await createTestUser('User B');
    const userC = await createTestUser('User C');
    const index1 = await createTestIndex('Index 1');
    const index2 = await createTestIndex('Index 2');

    const intentA1 = await createTestIntent(userA, 'Intent in index 1');
    const intentA2 = await createTestIntent(userA, 'Intent in index 2');
    const intentB = await createTestIntent(userB, 'B intent');
    const intentC = await createTestIntent(userC, 'C intent');

    await addMember(userA, index1);
    await addMember(userA, index2);
    await addMember(userB, index1);
    await addMember(userC, index2);
    await assignIntentToIndex(intentA1, index1);
    await assignIntentToIndex(intentA2, index2);
    await assignIntentToIndex(intentB, index1);
    await assignIntentToIndex(intentC, index2);
    await createTestStake([intentA1, intentB], 100, 'Match in index 1', agentId);
    await createTestStake([intentA2, intentC], 100, 'Match in index 2', agentId);

    const { results: discovered } = await discoverUsers({ 
      authenticatedUserId: userA,
      indexIds: [index1]
    });

    assertLength(discovered, 1, 'Should discover 1 user (filtered to index1)');
    assertContainsUser(discovered, userB, 'Should discover User B');
    assertNotContainsUser(discovered, userC, 'Should NOT discover User C');
  });

  // -------------------------------------------------------------------------
  // TEST 9: Intent in Multiple Indexes
  // -------------------------------------------------------------------------
  await test('discovers user when intent is assigned to multiple indexes and one overlaps', async () => {
    const userA = await createTestUser('User A');
    const userB = await createTestUser('User B');
    const index1 = await createTestIndex('Index 1');
    const index2 = await createTestIndex('Index 2');

    const intentA = await createTestIntent(userA, 'Looking for collaborators');
    const intentB = await createTestIntent(userB, 'Want to collaborate');

    await addMember(userA, index1);
    await addMember(userA, index2);
    await addMember(userB, index2);
    await assignIntentToIndex(intentA, index1);
    await assignIntentToIndex(intentA, index2); // A's intent in both
    await assignIntentToIndex(intentB, index2);
    await createTestStake([intentA, intentB], 100, 'Match', agentId);

    const { results: discovered } = await discoverUsers({ authenticatedUserId: userA });

    assertLength(discovered, 1, 'Should discover User B (shared index2)');
    assertContainsUser(discovered, userB, 'Should discover User B');
  });

  // -------------------------------------------------------------------------
  // TEST 10: Multiple Stakes Same Users
  // -------------------------------------------------------------------------
  await test('deduplicates users when multiple stakes connect same pair', async () => {
    const userA = await createTestUser('User A');
    const userB = await createTestUser('User B');
    const index1 = await createTestIndex('Index 1');

    const intentA1 = await createTestIntent(userA, 'Intent 1');
    const intentA2 = await createTestIntent(userA, 'Intent 2');
    const intentB1 = await createTestIntent(userB, 'B Intent 1');
    const intentB2 = await createTestIntent(userB, 'B Intent 2');

    await addMember(userA, index1);
    await addMember(userB, index1);
    await assignIntentToIndex(intentA1, index1);
    await assignIntentToIndex(intentA2, index1);
    await assignIntentToIndex(intentB1, index1);
    await assignIntentToIndex(intentB2, index1);
    await createTestStake([intentA1, intentB1], 100, 'Match 1', agentId);
    await createTestStake([intentA2, intentB2], 200, 'Match 2', agentId);

    const { results: discovered } = await discoverUsers({ authenticatedUserId: userA });

    assertLength(discovered, 1, 'Should discover User B once (deduplicated)');
    assertContainsUser(discovered, userB, 'Should discover User B');
  });

  // -------------------------------------------------------------------------
  // TEST 11: Empty - No Intents
  // -------------------------------------------------------------------------
  await test('returns empty when authenticated user has no intents', async () => {
    const userA = await createTestUser('User A');
    const userB = await createTestUser('User B');
    const index1 = await createTestIndex('Index 1');

    const intentB = await createTestIntent(userB, 'B has intent');

    await addMember(userA, index1);
    await addMember(userB, index1);
    await assignIntentToIndex(intentB, index1);

    const { results: discovered } = await discoverUsers({ authenticatedUserId: userA });

    assertLength(discovered, 0, 'Should discover no users (A has no intents)');
  });

  // -------------------------------------------------------------------------
  // TEST 12: Partial Multi-User (one outside shared index)
  // -------------------------------------------------------------------------
  await test('returns empty when stake includes user outside shared index', async () => {
    const userA = await createTestUser('User A');
    const userB = await createTestUser('User B');
    const userC = await createTestUser('User C');
    const index1 = await createTestIndex('Index 1');
    const index2 = await createTestIndex('Index 2');

    const intentA = await createTestIntent(userA, 'A intent');
    const intentB = await createTestIntent(userB, 'B intent');
    const intentC = await createTestIntent(userC, 'C intent');

    await addMember(userA, index1);
    await addMember(userB, index1);
    await addMember(userC, index2); // C not in index1
    await assignIntentToIndex(intentA, index1);
    await assignIntentToIndex(intentB, index1);
    await assignIntentToIndex(intentC, index2);
    await createTestStake([intentA, intentB, intentC], 100, 'All three', agentId);

    const { results: discovered } = await discoverUsers({ authenticatedUserId: userA });

    assertLength(discovered, 0, 'Should discover no users (C not in shared index)');
  });

  // -------------------------------------------------------------------------
  // TEST 13: User Has No Index Membership
  // -------------------------------------------------------------------------
  await test('returns empty when authenticated user is not a member of any index', async () => {
    const userA = await createTestUser('User A');
    const userB = await createTestUser('User B');
    const index1 = await createTestIndex('Index 1');

    const intentA = await createTestIntent(userA, 'A intent');
    const intentB = await createTestIntent(userB, 'B intent');

    // userA is NOT a member of any index
    await addMember(userB, index1);
    await assignIntentToIndex(intentA, index1); // Intent assigned but user not member
    await assignIntentToIndex(intentB, index1);
    await createTestStake([intentA, intentB], 100, 'Match', agentId);

    const { results: discovered } = await discoverUsers({ authenticatedUserId: userA });

    assertLength(discovered, 0, 'Should discover no users (A not in any index)');
  });

  // -------------------------------------------------------------------------
  // TEST 14: Both Users Have No Index Membership
  // -------------------------------------------------------------------------
  await test('returns empty when neither user is a member of any index', async () => {
    const userA = await createTestUser('User A');
    const userB = await createTestUser('User B');

    const intentA = await createTestIntent(userA, 'A intent');
    const intentB = await createTestIntent(userB, 'B intent');

    // Neither user is a member of any index
    // Intents exist but not assigned to any index
    await createTestStake([intentA, intentB], 100, 'Match', agentId);

    const { results: discovered } = await discoverUsers({ authenticatedUserId: userA });

    assertLength(discovered, 0, 'Should discover no users (neither in any index)');
  });

  // Final cleanup including agents
  await cleanup(true);

  // -------------------------------------------------------------------------
  // SUMMARY
  // -------------------------------------------------------------------------
  console.log('\n' + '='.repeat(60));
  console.log('📊 Test Summary\n');

  const passed = results.filter(r => r.passed).length;
  const failed = results.filter(r => !r.passed).length;

  console.log(`   Total:  ${results.length}`);
  console.log(`   Passed: ${passed}`);
  console.log(`   Failed: ${failed}`);

  if (failed > 0) {
    console.log('\n❌ Failed Tests:');
    for (const r of results.filter(r => !r.passed)) {
      console.log(`   - ${r.name}`);
      console.log(`     ${r.error}`);
    }
  }

  console.log('\n' + '='.repeat(60));
  process.exit(failed > 0 ? 1 : 0);
}

// Run
runTests().catch(e => {
  console.error('Test runner error:', e);
  cleanup(true).finally(() => process.exit(1));
});
