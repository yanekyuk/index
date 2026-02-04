/** Config */
import { config } from "dotenv";
config({ path: '.env.test' });

import { describe, test, expect } from 'bun:test';
import {
  selectStrategies,
  deriveRolesFromStrategy,
} from './opportunity.utils';

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
});
