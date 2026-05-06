import { describe, expect, it } from 'bun:test';

import {
  buildMainAgentPrompt,
  type OpportunityCandidate,
  type MainAgentPromptInput,
} from '../lib/delivery/main-agent.prompt.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeCandidate(
  overrides: Partial<OpportunityCandidate> = {},
): OpportunityCandidate {
  return {
    opportunityId: 'opp-1',
    counterpartUserId: 'user-1',
    feedCategory: 'connection',
    headline: 'Test headline',
    personalizedSummary: 'Summary',
    suggestedAction: 'Connect',
    narratorRemark: '',
    profileUrl: 'https://example.com/u/user-1',
    acceptUrl: 'https://example.com/api/opportunities/opp-1/connect?token=tok1',
    ...overrides,
  };
}

function makeConnectorCandidate(
  overrides: Partial<OpportunityCandidate> = {},
): OpportunityCandidate {
  return makeCandidate({
    feedCategory: 'connector-flow',
    acceptUrl: 'https://example.com/api/opportunities/opp-2/approve-introduction?token=tok2',
    ...overrides,
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('buildMainAgentPrompt', () => {
  describe('welcome prompt with two sections', () => {
    it('includes section headers when both feedCategories are present', () => {
      const input: MainAgentPromptInput = {
        contentType: 'welcome',
        mainAgentToolUse: 'disabled',
        payload: {
          contentType: 'welcome',
          totalPending: 5,
          candidates: [makeCandidate(), makeConnectorCandidate()],
        },
      };
      const prompt = buildMainAgentPrompt(input);
      expect(prompt).toContain('SECTION 1');
      expect(prompt).toContain('DIRECT CONNECTIONS');
      expect(prompt).toContain('SECTION 2');
      expect(prompt).toContain('HELP YOUR COMMUNITY');
    });

    it('skips empty section text is present in instructions', () => {
      const input: MainAgentPromptInput = {
        contentType: 'welcome',
        mainAgentToolUse: 'disabled',
        payload: {
          contentType: 'welcome',
          totalPending: 0,
          candidates: [],
        },
      };
      const prompt = buildMainAgentPrompt(input);
      expect(prompt).toContain('Skip any section with zero candidates');
    });
  });

  describe('daily digest prompt', () => {
    it('includes both section instructions', () => {
      const input: MainAgentPromptInput = {
        contentType: 'daily_digest',
        mainAgentToolUse: 'disabled',
        payload: {
          contentType: 'daily_digest',
          totalPending: 10,
          candidates: [makeCandidate(), makeConnectorCandidate()],
        },
      };
      const prompt = buildMainAgentPrompt(input);
      expect(prompt).toContain('SECTION 1');
      expect(prompt).toContain('SECTION 2');
      expect(prompt).toContain('HELP YOUR COMMUNITY');
    });

    it('includes overflow instruction', () => {
      const input: MainAgentPromptInput = {
        contentType: 'daily_digest',
        mainAgentToolUse: 'disabled',
        payload: {
          contentType: 'daily_digest',
          totalPending: 25,
          candidates: [makeCandidate()],
        },
      };
      const prompt = buildMainAgentPrompt(input);
      expect(prompt).toContain('totalPending > number of candidates shown');
    });
  });

  describe('ambient prompt', () => {
    it('has no mandatory section structure', () => {
      const input: MainAgentPromptInput = {
        contentType: 'ambient_discovery',
        mainAgentToolUse: 'disabled',
        payload: {
          contentType: 'ambient_discovery',
          ambientDeliveredToday: 1,
          totalPending: 5,
          candidates: [makeCandidate(), makeConnectorCandidate()],
        },
      };
      const prompt = buildMainAgentPrompt(input);
      // Ambient should NOT mandate sections — flat list, agent decides
      expect(prompt).not.toContain('SECTION 1');
      expect(prompt).not.toContain('SECTION 2');
      // But should mention both types
      expect(prompt).toContain("'connection'");
      expect(prompt).toContain("'connector-flow'");
    });

    it('includes overflow instruction', () => {
      const input: MainAgentPromptInput = {
        contentType: 'ambient_discovery',
        mainAgentToolUse: 'disabled',
        payload: {
          contentType: 'ambient_discovery',
          ambientDeliveredToday: 0,
          totalPending: 15,
          candidates: [makeCandidate()],
        },
      };
      const prompt = buildMainAgentPrompt(input);
      expect(prompt).toContain('totalPending > number of candidates shown');
    });
  });

  describe('connector-flow candidates use approve URL', () => {
    it('connector-flow acceptUrl uses /approve-introduction path', () => {
      const connector = makeConnectorCandidate();
      expect(connector.acceptUrl).toContain('/approve-introduction');
      expect(connector.acceptUrl).not.toContain('/connect?');
    });

    it('connection candidates use /connect path', () => {
      const connection = makeCandidate();
      expect(connection.acceptUrl).toContain('/connect?');
      expect(connection.acceptUrl).not.toContain('/approve-introduction');
    });
  });

  describe('MSG_PARAM_CLAUSE scoping', () => {
    it('greeting composition mentions connection candidates only', () => {
      const input: MainAgentPromptInput = {
        contentType: 'daily_digest',
        mainAgentToolUse: 'disabled',
        payload: {
          contentType: 'daily_digest',
          totalPending: 1,
          candidates: [makeCandidate()],
        },
      };
      const prompt = buildMainAgentPrompt(input);
      expect(prompt).toContain('connection candidates ONLY');
      expect(prompt).toContain('Do NOT compose a &msg= greeting for connector-flow');
    });
  });

  describe('branding injection', () => {
    it('includes COMMUNITY CONTEXT when branding is set', () => {
      const input: MainAgentPromptInput = {
        contentType: 'welcome',
        mainAgentToolUse: 'disabled',
        payload: {
          contentType: 'welcome',
          totalPending: 0,
          candidates: [],
        },
        branding: {
          nodeName: 'Test Community',
          nodeDescription: 'A community for testers.',
          nodeContext: 'Focus on QA and testing.',
        },
      };
      const prompt = buildMainAgentPrompt(input);
      expect(prompt).toContain('COMMUNITY CONTEXT');
      expect(prompt).toContain('Test Community');
      expect(prompt).toContain('A community for testers.');
      expect(prompt).toContain('Focus on QA and testing.');
    });

    it('omits COMMUNITY CONTEXT when branding is null', () => {
      const input: MainAgentPromptInput = {
        contentType: 'welcome',
        mainAgentToolUse: 'disabled',
        payload: {
          contentType: 'welcome',
          totalPending: 0,
          candidates: [],
        },
        branding: null,
      };
      const prompt = buildMainAgentPrompt(input);
      expect(prompt).not.toContain('COMMUNITY CONTEXT');
    });

    it('omits COMMUNITY CONTEXT when branding is undefined', () => {
      const input: MainAgentPromptInput = {
        contentType: 'welcome',
        mainAgentToolUse: 'disabled',
        payload: {
          contentType: 'welcome',
          totalPending: 0,
          candidates: [],
        },
      };
      const prompt = buildMainAgentPrompt(input);
      expect(prompt).not.toContain('COMMUNITY CONTEXT');
    });
  });

  describe('totalPending in payload', () => {
    it('welcome payload includes totalPending', () => {
      const input: MainAgentPromptInput = {
        contentType: 'welcome',
        mainAgentToolUse: 'disabled',
        payload: {
          contentType: 'welcome',
          totalPending: 42,
          candidates: [],
        },
      };
      const prompt = buildMainAgentPrompt(input);
      expect(prompt).toContain('"totalPending": 42');
    });

    it('daily_digest payload includes totalPending', () => {
      const input: MainAgentPromptInput = {
        contentType: 'daily_digest',
        mainAgentToolUse: 'disabled',
        payload: {
          contentType: 'daily_digest',
          totalPending: 10,
          candidates: [],
        },
      };
      const prompt = buildMainAgentPrompt(input);
      expect(prompt).toContain('"totalPending": 10');
    });

    it('ambient_discovery payload includes totalPending', () => {
      const input: MainAgentPromptInput = {
        contentType: 'ambient_discovery',
        mainAgentToolUse: 'disabled',
        payload: {
          contentType: 'ambient_discovery',
          ambientDeliveredToday: 0,
          totalPending: 7,
          candidates: [],
        },
      };
      const prompt = buildMainAgentPrompt(input);
      expect(prompt).toContain('"totalPending": 7');
    });
  });
});
