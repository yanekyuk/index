import { describe, expect, it } from 'bun:test';

import { buildOnboardingPrompt } from '../polling/onboarding/onboarding.prompt.js';

describe('buildOnboardingPrompt', () => {
  it('contains profile creation instructions', () => {
    const prompt = buildOnboardingPrompt();
    expect(prompt).toContain('create_user_profile');
  });

  it('contains community discovery instructions', () => {
    const prompt = buildOnboardingPrompt();
    expect(prompt).toContain('read_networks');
    expect(prompt).toContain('create_network_membership');
  });

  it('contains intent capture instructions', () => {
    const prompt = buildOnboardingPrompt();
    expect(prompt).toContain('create_intent');
  });

  it('contains complete_onboarding instruction', () => {
    const prompt = buildOnboardingPrompt();
    expect(prompt).toContain('complete_onboarding');
  });

  it('does NOT mention import_gmail_contacts', () => {
    const prompt = buildOnboardingPrompt();
    expect(prompt).not.toContain('import_gmail_contacts');
  });

  it('instructs the agent to skip community discovery for network-scoped keys', () => {
    // Network-scoped invitees (experiment-network CSV import) cannot join other
    // communities; their MCP key is bound to a single network. Without explicit
    // instruction the agent reads `memberOf` and presents the bound network as a
    // "community you might find relevant", which both surprises the user and
    // would re-trigger create_network_membership on a network they're already in.
    const prompt = buildOnboardingPrompt();
    expect(prompt).toMatch(/scopeRestriction\.isScoped/);
    expect(prompt.toLowerCase()).toMatch(/skip|do not list|do not propose/);
  });

  it('handles empty publicNetworks gracefully', () => {
    const prompt = buildOnboardingPrompt();
    expect(prompt).toMatch(/publicNetworks.*missing|missing.*publicNetworks|empty/);
  });
});
