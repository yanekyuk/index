import { describe, expect, test } from 'bun:test';
import { networkInvitationTemplate } from './network-invitation.template';

describe('networkInvitationTemplate', () => {
  test('subject names the network', () => {
    const out = networkInvitationTemplate({
      networkName: 'Edge City',
      apiKey: 'sk_test_RAW_KEY',
      connectCommand: 'openclaw index connect --api-key sk_test_RAW_KEY',
    });
    expect(out.subject).toMatch(/Edge City/);
  });

  test('html and text bodies include the raw key and connect command', () => {
    const out = networkInvitationTemplate({
      networkName: 'Edge City',
      apiKey: 'sk_test_RAW_KEY',
      connectCommand: 'openclaw index connect --api-key sk_test_RAW_KEY',
    });
    expect(out.html).toContain('sk_test_RAW_KEY');
    expect(out.html).toContain('openclaw index connect');
    expect(out.text).toContain('sk_test_RAW_KEY');
    expect(out.text).toContain('openclaw index connect');
  });

  test('html-escapes the network name to prevent injection', () => {
    const out = networkInvitationTemplate({
      networkName: '<script>x</script>',
      apiKey: 'k',
      connectCommand: 'cmd',
    });
    expect(out.html).not.toContain('<script>x</script>');
    expect(out.html).toContain('&lt;script&gt;');
  });

  test('html-escapes the api key (defense in depth)', () => {
    const out = networkInvitationTemplate({
      networkName: 'N',
      apiKey: '<script>x</script>',
      connectCommand: 'cmd',
    });
    expect(out.html).not.toContain('<script>x</script>');
  });

  test('strips CR/LF from the subject to prevent header injection', () => {
    const out = networkInvitationTemplate({
      networkName: 'Evil\r\nBcc: leak@example.com\r\nSubject: pwned',
      apiKey: 'k',
      connectCommand: 'cmd',
    });
    expect(out.subject).not.toMatch(/[\r\n]/);
  });
});
