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
});
