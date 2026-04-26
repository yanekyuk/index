/** Config */
import { config } from "dotenv";
config({ path: '.env.test' });

import { describe, expect, it, beforeAll, afterAll } from 'bun:test';
import { eq, inArray } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';
import db from '../../lib/drizzle/drizzle';
import {
  users,
  userProfiles,
} from '../../schemas/database.schema';
import { ProfileDatabaseAdapter } from '../database.adapter';

const TEST_PREFIX = 'ghost_dedup_spec_' + Date.now() + '_';
const adapter = new ProfileDatabaseAdapter();

interface TestIds {
  realUserId: string;
  ghostAId: string;
  ghostBId: string;
  ghostNoSocialsId: string;
  differentPersonId: string;
}
let ids: TestIds;

beforeAll(async () => {
  ids = {
    realUserId: uuidv4(),
    ghostAId: uuidv4(),
    ghostBId: uuidv4(),
    ghostNoSocialsId: uuidv4(),
    differentPersonId: uuidv4(),
  };

  await db.insert(users).values([
    {
      id: ids.realUserId,
      email: TEST_PREFIX + 'real@index.network',
      name: 'Seref Yarar',
      isGhost: false,
      socials: { linkedin: 'serefyarar', github: 'serefyarar', x: 'hyperseref' },
    },
    {
      id: ids.ghostAId,
      email: TEST_PREFIX + 'ghost-a@index.as',
      name: 'Seref Yarar',
      isGhost: true,
      socials: { linkedin: 'serefyarar' },
    },
    {
      id: ids.ghostBId,
      email: TEST_PREFIX + 'ghost-b@gowit.dev',
      name: 'Serafettin Yarar',
      isGhost: true,
      socials: { github: 'serefyarar' },
    },
    {
      id: ids.ghostNoSocialsId,
      email: TEST_PREFIX + 'ghost-nosocials@test.com',
      name: 'Seref Yarar',
      isGhost: true,
      socials: null,
    },
    {
      id: ids.differentPersonId,
      email: TEST_PREFIX + 'different@nato.int',
      name: 'Seref Ozu',
      isGhost: true,
      socials: { linkedin: 'serefozu-b5b87322a' },
    },
  ]);
});

afterAll(async () => {
  const allIds = Object.values(ids);
  await db.delete(userProfiles).where(inArray(userProfiles.userId, allIds));
  await db.delete(users).where(inArray(users.id, allIds));
});

describe('ProfileDatabaseAdapter.findDuplicateUser', () => {
  it('matches by LinkedIn handle and prefers real user over ghost', async () => {
    const result = await adapter.findDuplicateUser(ids.ghostAId, { linkedin: 'serefyarar' });
    expect(result).not.toBeNull();
    expect(result!.id).toBe(ids.realUserId);
  });

  it('matches by GitHub handle', async () => {
    const result = await adapter.findDuplicateUser(ids.ghostBId, { github: 'serefyarar' });
    expect(result).not.toBeNull();
    expect(result!.id).toBe(ids.realUserId);
  });

  it('matches by X handle', async () => {
    const newGhostId = uuidv4();
    await db.insert(users).values({
      id: newGhostId,
      email: TEST_PREFIX + 'ghost-x@test.com',
      name: 'Seref X',
      isGhost: true,
    });
    try {
      const result = await adapter.findDuplicateUser(newGhostId, { x: 'hyperseref' });
      expect(result).not.toBeNull();
      expect(result!.id).toBe(ids.realUserId);
    } finally {
      await db.delete(users).where(eq(users.id, newGhostId));
    }
  });

  it('is case-insensitive', async () => {
    const result = await adapter.findDuplicateUser(ids.ghostAId, { linkedin: 'SerefYarar' });
    expect(result).not.toBeNull();
    expect(result!.id).toBe(ids.realUserId);
  });

  it('does not match different social handles', async () => {
    const result = await adapter.findDuplicateUser(ids.differentPersonId, { linkedin: 'serefozu-b5b87322a' });
    expect(result).toBeNull();
  });

  it('returns null when no socials provided', async () => {
    const result = await adapter.findDuplicateUser(ids.ghostNoSocialsId, {});
    expect(result).toBeNull();
  });

  it('excludes soft-deleted users from matching', async () => {
    const deletedId = uuidv4();
    await db.insert(users).values({
      id: deletedId,
      email: TEST_PREFIX + 'deleted@test.com',
      name: 'Deleted User',
      isGhost: true,
      socials: { linkedin: 'deleted-handle-unique' },
      deletedAt: new Date(),
    });
    try {
      const result = await adapter.findDuplicateUser(ids.ghostAId, { linkedin: 'deleted-handle-unique' });
      expect(result).toBeNull();
    } finally {
      await db.delete(users).where(eq(users.id, deletedId));
    }
  });
});
