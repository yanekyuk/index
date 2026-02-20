/** Config */
import { config } from "dotenv";
config({ path: '.env.test' });

import { describe, test, expect } from 'bun:test';
import {
  selectStrategies,
  deriveRolesFromStrategy,
  canUserSeeOpportunity,
  isActionableForViewer,
  validateOpportunityActors,
} from '../opportunity.utils';

describe('opportunity.utils', () => {
  describe('selectStrategies', () => {
    test('returns mirror and reciprocal by default', () => {
      const strategies = selectStrategies('Looking for a co-founder');
      expect(strategies).toContain('mirror');
      expect(strategies).toContain('reciprocal');
    });

    test('adds mentor when intent or category mentions mentor', () => {
      const strategies = selectStrategies('I want to learn from a mentor', {
        category: 'guidance',
      });
      expect(strategies).toContain('mentor');
    });

    test('adds investor when intent mentions raise/funding', () => {
      const strategies = selectStrategies('We need to raise a seed round', {
        category: 'funding',
      });
      expect(strategies).toContain('investor');
    });

    test('adds collaborator for co-founder/partner', () => {
      const strategies = selectStrategies('Looking for a technical co-founder');
      expect(strategies).toContain('collaborator');
    });

    test('adds hiree when intent mentions hiring', () => {
      const strategies = selectStrategies('We are hiring a React developer');
      expect(strategies).toContain('hiree');
    });
  });

  describe('deriveRolesFromStrategy', () => {
    test('mirror: source patient, candidate agent', () => {
      const r = deriveRolesFromStrategy('mirror');
      expect(r.sourceRole).toBe('patient');
      expect(r.candidateRole).toBe('agent');
    });

    test('reciprocal: source agent, candidate patient', () => {
      const r = deriveRolesFromStrategy('reciprocal');
      expect(r.sourceRole).toBe('agent');
      expect(r.candidateRole).toBe('patient');
    });

    test('collaborator: both peer', () => {
      const r = deriveRolesFromStrategy('collaborator');
      expect(r.sourceRole).toBe('peer');
      expect(r.candidateRole).toBe('peer');
    });

    test('hiree: source agent, candidate patient', () => {
      const r = deriveRolesFromStrategy('hiree');
      expect(r.sourceRole).toBe('agent');
      expect(r.candidateRole).toBe('patient');
    });
  });

  // ─── canUserSeeOpportunity ───────────────────────────────────────────────
  // Tests the Compact Visibility Rule from Latent Opportunity Lifecycle doc:
  // - Introducer or peer: always see.
  // - Patient or party: see if (status ≠ latent, or there is no introducer).
  // - Agent: see if (status ∈ {accepted, rejected, expired}, or (status ≠ latent and no introducer)).

  describe('canUserSeeOpportunity', () => {
    const STATUSES = ['latent', 'pending', 'viewed', 'accepted', 'rejected', 'expired'] as const;
    const VIEWER = 'user-viewer';

    // Helper to build actors array
    const actors = (viewerRole: string, hasIntroducer: boolean) => {
      const list: Array<{ userId: string; role: string }> = [
        { userId: VIEWER, role: viewerRole },
        { userId: 'user-other', role: 'patient' },
      ];
      if (hasIntroducer && viewerRole !== 'introducer') {
        list.push({ userId: 'user-intro', role: 'introducer' });
      }
      return list;
    };

    test('returns false when user is not an actor', () => {
      const a = [{ userId: 'someone-else', role: 'patient' }];
      for (const status of STATUSES) {
        expect(canUserSeeOpportunity(a, status, VIEWER)).toBe(false);
      }
    });

    // Introducer: always sees (all statuses)
    describe('introducer', () => {
      for (const status of STATUSES) {
        test(`sees at ${status}`, () => {
          const a = [
            { userId: VIEWER, role: 'introducer' },
            { userId: 'user-b', role: 'patient' },
            { userId: 'user-c', role: 'agent' },
          ];
          expect(canUserSeeOpportunity(a, status, VIEWER)).toBe(true);
        });
      }
    });

    // Peer: always sees (all statuses)
    describe('peer', () => {
      for (const status of STATUSES) {
        test(`sees at ${status}`, () => {
          const a = [
            { userId: VIEWER, role: 'peer' },
            { userId: 'user-other', role: 'peer' },
          ];
          expect(canUserSeeOpportunity(a, status, VIEWER)).toBe(true);
        });
      }
    });

    // Patient without introducer: sees at all statuses
    describe('patient without introducer', () => {
      for (const status of STATUSES) {
        test(`sees at ${status}`, () => {
          expect(canUserSeeOpportunity(actors('patient', false), status, VIEWER)).toBe(true);
        });
      }
    });

    // Patient with introducer: cannot see at latent, can see at all others
    describe('patient with introducer', () => {
      test('cannot see at latent', () => {
        expect(canUserSeeOpportunity(actors('patient', true), 'latent', VIEWER)).toBe(false);
      });
      for (const status of ['pending', 'viewed', 'accepted', 'rejected', 'expired'] as const) {
        test(`sees at ${status}`, () => {
          expect(canUserSeeOpportunity(actors('patient', true), status, VIEWER)).toBe(true);
        });
      }
    });

    // Party: same as patient
    describe('party without introducer', () => {
      for (const status of STATUSES) {
        test(`sees at ${status}`, () => {
          expect(canUserSeeOpportunity(actors('party', false), status, VIEWER)).toBe(true);
        });
      }
    });

    describe('party with introducer', () => {
      test('cannot see at latent', () => {
        expect(canUserSeeOpportunity(actors('party', true), 'latent', VIEWER)).toBe(false);
      });
      for (const status of ['pending', 'viewed', 'accepted', 'rejected', 'expired'] as const) {
        test(`sees at ${status}`, () => {
          expect(canUserSeeOpportunity(actors('party', true), status, VIEWER)).toBe(true);
        });
      }
    });

    // Agent without introducer: cannot see at latent, can see at pending+
    describe('agent without introducer', () => {
      test('cannot see at latent', () => {
        const a = [
          { userId: VIEWER, role: 'agent' },
          { userId: 'user-other', role: 'patient' },
        ];
        expect(canUserSeeOpportunity(a, 'latent', VIEWER)).toBe(false);
      });
      for (const status of ['pending', 'viewed', 'accepted', 'rejected', 'expired'] as const) {
        test(`sees at ${status}`, () => {
          const a = [
            { userId: VIEWER, role: 'agent' },
            { userId: 'user-other', role: 'patient' },
          ];
          expect(canUserSeeOpportunity(a, status, VIEWER)).toBe(true);
        });
      }
    });

    // Agent with introducer: only sees at accepted/rejected/expired
    describe('agent with introducer', () => {
      for (const status of ['latent', 'pending', 'viewed'] as const) {
        test(`cannot see at ${status}`, () => {
          const a = [
            { userId: VIEWER, role: 'agent' },
            { userId: 'user-intro', role: 'introducer' },
            { userId: 'user-patient', role: 'patient' },
          ];
          expect(canUserSeeOpportunity(a, status, VIEWER)).toBe(false);
        });
      }
      for (const status of ['accepted', 'rejected', 'expired'] as const) {
        test(`sees at ${status}`, () => {
          const a = [
            { userId: VIEWER, role: 'agent' },
            { userId: 'user-intro', role: 'introducer' },
            { userId: 'user-patient', role: 'patient' },
          ];
          expect(canUserSeeOpportunity(a, status, VIEWER)).toBe(true);
        });
      }
    });
  });

  // ─── isActionableForViewer ───────────────────────────────────────────────
  // Tests the Home feed actionability matrix: which status × role combos
  // have a pending action (Send, Accept/Reject, Go to chat).

  describe('isActionableForViewer', () => {
    const VIEWER = 'user-viewer';

    test('returns false when user is not an actor', () => {
      const a = [{ userId: 'someone-else', role: 'patient' }];
      expect(isActionableForViewer(a, 'latent', VIEWER)).toBe(false);
    });

    // Introducer: actionable only at latent (can Send)
    describe('introducer', () => {
      test('actionable at latent', () => {
        const a = [
          { userId: VIEWER, role: 'introducer' },
          { userId: 'b', role: 'patient' },
        ];
        expect(isActionableForViewer(a, 'latent', VIEWER)).toBe(true);
      });
      for (const status of ['pending', 'viewed', 'accepted', 'rejected', 'expired'] as const) {
        test(`not actionable at ${status}`, () => {
          const a = [
            { userId: VIEWER, role: 'introducer' },
            { userId: 'b', role: 'patient' },
          ];
          expect(isActionableForViewer(a, status, VIEWER)).toBe(false);
        });
      }
    });

    // Patient/party with introducer: actionable at pending and viewed (Accept/Reject)
    describe('patient with introducer', () => {
      const makeActors = () => [
        { userId: VIEWER, role: 'patient' },
        { userId: 'intro', role: 'introducer' },
        { userId: 'agent-user', role: 'agent' },
      ];
      test('not actionable at latent', () => {
        expect(isActionableForViewer(makeActors(), 'latent', VIEWER)).toBe(false);
      });
      test('actionable at pending', () => {
        expect(isActionableForViewer(makeActors(), 'pending', VIEWER)).toBe(true);
      });
      test('actionable at viewed', () => {
        expect(isActionableForViewer(makeActors(), 'viewed', VIEWER)).toBe(true);
      });
      for (const status of ['accepted', 'rejected', 'expired'] as const) {
        test(`not actionable at ${status}`, () => {
          expect(isActionableForViewer(makeActors(), status, VIEWER)).toBe(false);
        });
      }
    });

    // Patient/party without introducer: actionable at latent only (can Send)
    describe('patient without introducer', () => {
      const makeActors = () => [
        { userId: VIEWER, role: 'patient' },
        { userId: 'agent-user', role: 'agent' },
      ];
      test('actionable at latent', () => {
        expect(isActionableForViewer(makeActors(), 'latent', VIEWER)).toBe(true);
      });
      for (const status of ['pending', 'viewed', 'accepted', 'rejected', 'expired'] as const) {
        test(`not actionable at ${status}`, () => {
          expect(isActionableForViewer(makeActors(), status, VIEWER)).toBe(false);
        });
      }
    });

    // Agent with introducer: actionable at accepted only (Go to chat)
    describe('agent with introducer', () => {
      const makeActors = () => [
        { userId: VIEWER, role: 'agent' },
        { userId: 'intro', role: 'introducer' },
        { userId: 'patient-user', role: 'patient' },
      ];
      test('actionable at accepted', () => {
        expect(isActionableForViewer(makeActors(), 'accepted', VIEWER)).toBe(true);
      });
      for (const status of ['latent', 'pending', 'viewed', 'rejected', 'expired'] as const) {
        test(`not actionable at ${status}`, () => {
          expect(isActionableForViewer(makeActors(), status, VIEWER)).toBe(false);
        });
      }
    });

    // Agent without introducer: actionable at pending and viewed (Accept/Reject)
    describe('agent without introducer', () => {
      const makeActors = () => [
        { userId: VIEWER, role: 'agent' },
        { userId: 'patient-user', role: 'patient' },
      ];
      for (const status of ['pending', 'viewed'] as const) {
        test(`actionable at ${status}`, () => {
          expect(isActionableForViewer(makeActors(), status, VIEWER)).toBe(true);
        });
      }
      for (const status of ['latent', 'accepted', 'rejected', 'expired'] as const) {
        test(`not actionable at ${status}`, () => {
          expect(isActionableForViewer(makeActors(), status, VIEWER)).toBe(false);
        });
      }
    });

    // Peer: actionable at latent, pending, viewed
    describe('peer', () => {
      const makeActors = () => [
        { userId: VIEWER, role: 'peer' },
        { userId: 'other-peer', role: 'peer' },
      ];
      for (const status of ['latent', 'pending', 'viewed'] as const) {
        test(`actionable at ${status}`, () => {
          expect(isActionableForViewer(makeActors(), status, VIEWER)).toBe(true);
        });
      }
      for (const status of ['accepted', 'rejected', 'expired'] as const) {
        test(`not actionable at ${status}`, () => {
          expect(isActionableForViewer(makeActors(), status, VIEWER)).toBe(false);
        });
      }
    });
  });

  describe('validateOpportunityActors', () => {
    test('rejects when there is an introducer but not exactly two non-introducer actors (1 introducer + 1 party)', () => {
      const actors = [
        { role: 'introducer' },
        { role: 'party' },
      ];
      expect(() => validateOpportunityActors(actors)).toThrow(
        /An opportunity with only two actors cannot have an introducer/
      );
    });

    test('rejects when there is an introducer and three non-introducer actors', () => {
      const actors = [
        { role: 'introducer' },
        { role: 'party' },
        { role: 'party' },
        { role: 'party' },
      ];
      expect(() => validateOpportunityActors(actors)).toThrow(
        /An opportunity with an introducer must have exactly two other actors/
      );
    });

    test('rejects when exactly two actors and one is introducer', () => {
      const actors = [
        { role: 'party' },
        { role: 'introducer' },
      ];
      expect(() => validateOpportunityActors(actors)).toThrow(
        /An opportunity with only two actors cannot have an introducer/
      );
    });

    test('accepts three actors: two party + one introducer', () => {
      const actors = [
        { role: 'party' },
        { role: 'party' },
        { role: 'introducer' },
      ];
      expect(() => validateOpportunityActors(actors)).not.toThrow();
    });

    test('accepts two actors: two party (no introducer)', () => {
      const actors = [
        { role: 'party' },
        { role: 'agent' },
      ];
      expect(() => validateOpportunityActors(actors)).not.toThrow();
    });
  });
});
