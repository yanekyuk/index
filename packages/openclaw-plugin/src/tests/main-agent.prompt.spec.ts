import { describe, expect, it } from 'bun:test';

import {
  buildMainAgentPrompt,
  type OpportunityCandidate,
} from '../lib/delivery/main-agent.prompt.js';

const cand: OpportunityCandidate = {
  opportunityId: 'opp-1',
  counterpartUserId: 'u-1',
  headline: 'h',
  personalizedSummary: 's',
  suggestedAction: 'a',
  narratorRemark: 'n',
  profileUrl: 'https://x/u/u-1',
  acceptUrl: 'https://x/o/opp-1/accept',
  skipUrl: 'https://x/o/opp-1/skip',
};

describe('buildMainAgentPrompt — ambient_discovery', () => {
  it('mentions today\'s ambient count and ≤3/day target when count provided', () => {
    const out = buildMainAgentPrompt({
      contentType: 'ambient_discovery',
      mainAgentToolUse: 'enabled',
      payload: { contentType: 'ambient_discovery', ambientDeliveredToday: 2, candidates: [cand] },
    });
    expect(out).toContain('2');
    expect(out).toContain('3');
  });

  it('explicitly tells the agent the digest will sweep what it skips', () => {
    const out = buildMainAgentPrompt({
      contentType: 'ambient_discovery',
      mainAgentToolUse: 'enabled',
      payload: { contentType: 'ambient_discovery', ambientDeliveredToday: 0, candidates: [cand] },
    });
    expect(out.toLowerCase()).toContain('digest');
  });

  it('mandates the confirm_opportunity_delivery call with trigger ambient', () => {
    const out = buildMainAgentPrompt({
      contentType: 'ambient_discovery',
      mainAgentToolUse: 'enabled',
      payload: { contentType: 'ambient_discovery', ambientDeliveredToday: 0, candidates: [cand] },
    });
    expect(out).toContain('confirm_opportunity_delivery');
    expect(out).toContain("'ambient'");
  });

  it('handles ambientDeliveredToday=null with a "count unknown" hint', () => {
    const out = buildMainAgentPrompt({
      contentType: 'ambient_discovery',
      mainAgentToolUse: 'enabled',
      payload: { contentType: 'ambient_discovery', ambientDeliveredToday: null, candidates: [cand] },
    });
    expect(out.toLowerCase()).toContain('unknown');
  });
});

describe('buildMainAgentPrompt — daily_digest', () => {
  it('mentions the ambient pass came earlier', () => {
    const out = buildMainAgentPrompt({
      contentType: 'daily_digest',
      mainAgentToolUse: 'enabled',
      payload: { contentType: 'daily_digest', candidates: [cand] },
    });
    expect(out.toLowerCase()).toContain('ambient');
  });

  it('mandates the confirm_opportunity_delivery call with trigger digest', () => {
    const out = buildMainAgentPrompt({
      contentType: 'daily_digest',
      mainAgentToolUse: 'enabled',
      payload: { contentType: 'daily_digest', candidates: [cand] },
    });
    expect(out).toContain('confirm_opportunity_delivery');
    expect(out).toContain("'digest'");
  });
});

describe('buildMainAgentPrompt — toolUseClause wording', () => {
  it('forbids enrichment tool calls (not all calls) when disabled', () => {
    const out = buildMainAgentPrompt({
      contentType: 'daily_digest',
      mainAgentToolUse: 'disabled',
      payload: { contentType: 'daily_digest', candidates: [cand] },
    });
    expect(out.toLowerCase()).toContain('enrichment');
    expect(out).not.toContain('Do not call any tools');
  });
});
