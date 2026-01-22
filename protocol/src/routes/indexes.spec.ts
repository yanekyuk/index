import { describe, test, expect, spyOn, mock, beforeAll } from 'bun:test';
import { Response } from 'express';

// Mocks must be declared before imports
// Mocks must be declared before imports
const mockDb: any = {
  select: () => mockDb,
  from: () => mockDb,
  where: () => mockDb,
  limit: () => mockDb,
  insert: () => mockDb,
  values: () => mockDb,
  returning: () => mockDb,
  update: () => mockDb,
  set: () => mockDb,
  delete: () => mockDb,
  innerJoin: () => mockDb,
  orderBy: () => mockDb,
  offset: () => mockDb,
};

mock.module('../lib/db', () => ({
  default: mockDb,
  users: { id: 'users.id', email: 'users.email', name: 'users.name', avatar: 'users.avatar' },
  indexes: { id: 'indexes.id', title: 'indexes.title', prompt: 'indexes.prompt', permissions: 'indexes.permissions' },
  indexMembers: { indexId: 'indexMembers.indexId' }
}));

mock.module('../middleware/auth', () => ({
  authenticatePrivy: (req: any, res: any, next: any) => next(),
  AuthRequest: {}
}));

mock.module('express-validator', () => ({
  validationResult: () => ({ isEmpty: () => true, array: () => [] }),
  body: () => ({ trim: () => ({ isLength: () => { } }), optional: () => ({ trim: () => { }, isIn: () => { } }) })
}));

// We also need to mock index-members.ts because createIndexHandler calls addMemberToIndex
mock.module('../lib/index-members', () => ({
  addMemberToIndex: async () => ({ success: true })
}));

import { createIndexHandler } from './indexes';

describe('createIndexHandler', () => {
  // Helper to create mock request and response
  const createMocks = (user: any, body: any) => {
    const req = {
      user,
      body,
      headers: {},
      get: () => { }
    } as any;

    const res = {
      status: mock(() => res),
      json: mock(() => res),
    } as any;

    return { req, res };
  };

  test('should allow creation for @index.network email', async () => {
    const { req, res } = createMocks(
      { id: 'user-1' },
      { title: 'Test Index' }
    );

    // Spy on DB methods
    // We need to return the mockDb object for chaining
    // But for the FINAL methods (limit, returning), we need to return data

    const limitSpy = spyOn(mockDb, 'limit');
    // First limit call: check email (success)
    // Second limit call: get user info (for response)
    limitSpy.mockResolvedValueOnce([{ email: 'test@index.network', name: 'Test', avatar: 'avatar' }]);
    limitSpy.mockResolvedValueOnce([{ name: 'Test', avatar: 'avatar' }]);

    const returningSpy = spyOn(mockDb, 'returning');
    returningSpy.mockResolvedValueOnce([{
      id: 'index-1',
      title: 'Test Index',
      permissions: {},
      createdAt: new Date(),
      updatedAt: new Date()
    }]);

    await createIndexHandler(req, res);

    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      message: 'Index created successfully'
    }));
  });

  test('should forbid creation for non-index.network email', async () => {
    const { req, res } = createMocks(
      { id: 'user-2' },
      { title: 'Forbidden Index' }
    );

    const limitSpy = spyOn(mockDb, 'limit');
    // First limit call: check email (fail)
    limitSpy.mockResolvedValueOnce([{ email: 'test@gmail.com' }]);

    await createIndexHandler(req, res);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      error: 'Only @index.network members can create indexes'
    }));
  });

  test('should handle no user found', async () => {
    const { req, res } = createMocks(
      { id: 'user-3' },
      { title: 'Ghost Index' }
    );

    const limitSpy = spyOn(mockDb, 'limit');
    limitSpy.mockResolvedValueOnce([]); // No user

    await createIndexHandler(req, res);

    // Should be 403 because undefined email doesn't end with @index.network
    expect(res.status).toHaveBeenCalledWith(403);
  });
});
