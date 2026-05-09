import { describe, expect, it } from 'bun:test';

import { networkInvitationTemplate } from '../templates/network-invitation.template';

describe('networkInvitationTemplate', () => {
  const baseParams = {
    networkName: 'Experiment X',
    apiKey: 'a-very-secret-key',
    connectCommand: 'openclaw connect --key=a-very-secret-key',
  };

  it('renders the original invitation when isResend is omitted', () => {
    const out = networkInvitationTemplate(baseParams);
    expect(out.subject).toBe('Your invitation to Experiment X');
    expect(out.text).toContain("You've been added to Experiment X");
    expect(out.text).not.toContain('previous key has been revoked');
    expect(out.html).not.toContain('previous key has been revoked');
  });

  it('renders the original invitation when isResend is false', () => {
    const out = networkInvitationTemplate({ ...baseParams, isResend: false });
    expect(out.subject).toBe('Your invitation to Experiment X');
    expect(out.text).not.toContain('previous key has been revoked');
  });

  it('renders the refreshed variant when isResend is true', () => {
    const out = networkInvitationTemplate({ ...baseParams, isResend: true });
    expect(out.subject).toBe('Your access key for Experiment X (refreshed)');
    expect(out.text.startsWith('Your previous key has been revoked. Use the key below going forward.')).toBe(true);
    expect(out.html).toContain('Your previous key has been revoked. Use the key below going forward.');
    expect(out.text).toContain(baseParams.apiKey);
    expect(out.text).toContain(baseParams.connectCommand);
  });

  it('strips control chars from refreshed subject just like the original', () => {
    const out = networkInvitationTemplate({
      ...baseParams,
      networkName: 'Bad\r\nNetwork',
      isResend: true,
    });
    expect(out.subject).toBe('Your access key for Bad Network (refreshed)');
  });
});
