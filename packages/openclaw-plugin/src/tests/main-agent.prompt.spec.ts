import { describe, expect, it } from 'bun:test';
import {
  buildMainAgentPrompt,
  type MainAgentPromptInput,
} from '../lib/delivery/main-agent.prompt.js';

const baseDigest: MainAgentPromptInput = {
  contentType: 'daily_digest',
  mainAgentToolUse: 'disabled',
  allowSuppress: true,
  payload: {
    contentType: 'daily_digest',
    maxToSurface: 5,
    candidates: [
      {
        opportunityId: 'opp-1',
        counterpartUserId: 'user-1',
        headline: 'H1',
        personalizedSummary: 'S1',
        suggestedAction: 'A1',
        narratorRemark: 'N1',
        profileUrl: 'https://example.com/u/user-1',
        acceptUrl: 'https://example.com/o/opp-1/accept',
        skipUrl: 'https://example.com/o/opp-1/skip',
      },
    ],
  },
};

describe('buildMainAgentPrompt', () => {
  it('includes the URL preservation clause', () => {
    const out = buildMainAgentPrompt(baseDigest);
    expect(out).toContain('include its acceptUrl and skipUrl');
  });

  it('forbids tool calls when mainAgentToolUse=disabled', () => {
    const out = buildMainAgentPrompt({ ...baseDigest, mainAgentToolUse: 'disabled' });
    expect(out).toContain('Do not call any tools');
  });

  it('permits tool calls when mainAgentToolUse=enabled', () => {
    const out = buildMainAgentPrompt({ ...baseDigest, mainAgentToolUse: 'enabled' });
    expect(out).toContain('You may call Index Network MCP tools');
    expect(out).not.toContain('Do not call any tools');
  });

  it('includes NO_REPLY clause when allowSuppress=true', () => {
    const out = buildMainAgentPrompt({ ...baseDigest, allowSuppress: true });
    expect(out).toContain('NO_REPLY');
  });

  it('omits NO_REPLY clause when allowSuppress=false (test_message)', () => {
    const out = buildMainAgentPrompt({
      contentType: 'test_message',
      mainAgentToolUse: 'disabled',
      allowSuppress: false,
      payload: { contentType: 'test_message', content: 'hello world' },
    });
    expect(out).not.toContain('NO_REPLY');
  });

  it('daily_digest instruction mentions ranking and maxToSurface', () => {
    const out = buildMainAgentPrompt(baseDigest);
    expect(out.toLowerCase()).toContain('rank');
    expect(out).toContain('5'); // maxToSurface
  });

  it('ambient_discovery instruction mentions real-time alert', () => {
    const out = buildMainAgentPrompt({
      ...baseDigest,
      contentType: 'ambient_discovery',
      payload: { ...baseDigest.payload as { contentType: 'ambient_discovery' | 'daily_digest'; maxToSurface: number; candidates: unknown[] }, contentType: 'ambient_discovery' },
    });
    expect(out.toLowerCase()).toContain('real-time');
  });

  it('test_message instruction mentions verification', () => {
    const out = buildMainAgentPrompt({
      contentType: 'test_message',
      mainAgentToolUse: 'disabled',
      allowSuppress: false,
      payload: { contentType: 'test_message', content: 'hello world' },
    });
    expect(out.toLowerCase()).toContain('verification');
  });

  it('INPUT block contains valid JSON of the payload', () => {
    const out = buildMainAgentPrompt(baseDigest);
    const match = out.match(/===== INPUT =====\n([\s\S]*?)\n===== END INPUT =====/);
    expect(match).not.toBeNull();
    const parsed = JSON.parse(match![1]);
    expect(parsed.contentType).toBe('daily_digest');
    expect(parsed.candidates).toHaveLength(1);
    expect(parsed.candidates[0].opportunityId).toBe('opp-1');
  });
});
