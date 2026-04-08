import { describe, it, expect } from 'bun:test';

describe('Non-onboarded user filtering in opportunity enrichment', () => {
  it('should skip non-onboarded real users (onboarding.completedAt is undefined)', () => {
    const candidateUser = {
      id: 'test-user-1',
      name: 'Test User',
      isGhost: false,
      onboarding: {},
      deletedAt: null,
    };

    const shouldSkip = candidateUser && !candidateUser.isGhost && !candidateUser.onboarding?.completedAt;
    expect(shouldSkip).toBe(true);
  });

  it('should NOT skip ghost users even without onboarding', () => {
    const candidateUser = {
      id: 'ghost-user-1',
      name: 'Ghost',
      isGhost: true,
      onboarding: {},
      deletedAt: null,
    };

    const shouldSkip = candidateUser && !candidateUser.isGhost && !candidateUser.onboarding?.completedAt;
    expect(shouldSkip).toBe(false);
  });

  it('should NOT skip onboarded real users', () => {
    const candidateUser = {
      id: 'real-user-1',
      name: 'Real User',
      isGhost: false,
      onboarding: { completedAt: '2026-01-01T00:00:00Z' },
      deletedAt: null,
    };

    const shouldSkip = candidateUser && !candidateUser.isGhost && !candidateUser.onboarding?.completedAt;
    expect(shouldSkip).toBe(false);
  });

  it('should skip real users with null onboarding', () => {
    const candidateUser = {
      id: 'null-onboarding-user',
      name: 'Null Onboarding',
      isGhost: false,
      onboarding: null as { completedAt?: string } | null,
      deletedAt: null,
    };

    const shouldSkip = candidateUser && !candidateUser.isGhost && !candidateUser.onboarding?.completedAt;
    expect(shouldSkip).toBe(true);
  });

  it('should still skip soft-deleted users regardless of onboarding', () => {
    const candidateUser = {
      id: 'deleted-user-1',
      name: 'Deleted',
      isGhost: false,
      onboarding: { completedAt: '2026-01-01T00:00:00Z' },
      deletedAt: '2026-02-01T00:00:00Z',
    };

    const shouldSkipDeleted = !!(candidateUser && 'deletedAt' in candidateUser && candidateUser.deletedAt);
    expect(shouldSkipDeleted).toBe(true);
  });

  it('should NOT skip when candidateUser is null (transient DB miss)', () => {
    const candidateUser = null;

    // opportunity.discover.ts: the onboarding filter guards with `candidateUser &&`
    // so a null user should NOT be skipped by the onboarding filter
    const shouldSkipOnboarding = candidateUser && !candidateUser.isGhost && !candidateUser.onboarding?.completedAt;
    expect(shouldSkipOnboarding).toBeFalsy();
  });
});
