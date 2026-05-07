import { describe, expect, it, mock } from 'bun:test';

import { readNodeBranding } from '../lib/delivery/config.js';
import type { OpenClawPluginApi } from '../lib/openclaw/plugin-api.js';

function makeApi(pluginConfig: Record<string, unknown> = {}): OpenClawPluginApi {
  return {
    id: 'indexnetwork-openclaw-plugin',
    name: 'Index Network',
    pluginConfig,
    config: {
      gateway: { port: 18789 },
      hooks: { enabled: true, token: 'hooks-tok', path: '/hooks' },
    },
    runtime: {
      subagent: {
        run: mock(async () => ({ runId: 'unused' })),
        waitForRun: mock(async () => ({ result: null })),
        getSessionMessages: mock(async () => ({ messages: [] })),
      },
    },
    logger: {
      debug: mock(() => {}),
      info: mock(() => {}),
      warn: mock(() => {}),
      error: mock(() => {}),
    },
    registerHttpRoute: mock(() => {}),
  };
}

describe('readNodeBranding', () => {
  it('returns null when nodeName is not set', () => {
    const api = makeApi({});
    expect(readNodeBranding(api)).toBeNull();
  });

  it('returns null when nodeName is an empty string', () => {
    const api = makeApi({ nodeName: '   ' });
    expect(readNodeBranding(api)).toBeNull();
  });

  it('returns branding with nodeName only', () => {
    const api = makeApi({ nodeName: 'TestNode' });
    const branding = readNodeBranding(api);
    expect(branding).not.toBeNull();
    expect(branding!.nodeName).toBe('TestNode');
    expect(branding!.nodeDescription).toBeUndefined();
    expect(branding!.nodeContext).toBeUndefined();
  });

  it('returns full branding when all fields set', () => {
    const api = makeApi({
      nodeName: 'TestNode',
      nodeDescription: 'A test community',
      nodeContext: 'Focus on testing',
    });
    const branding = readNodeBranding(api);
    expect(branding).not.toBeNull();
    expect(branding!.nodeName).toBe('TestNode');
    expect(branding!.nodeDescription).toBe('A test community');
    expect(branding!.nodeContext).toBe('Focus on testing');
  });

  it('trims whitespace from values', () => {
    const api = makeApi({
      nodeName: '  TestNode  ',
      nodeDescription: '  desc  ',
    });
    const branding = readNodeBranding(api);
    expect(branding!.nodeName).toBe('TestNode');
    expect(branding!.nodeDescription).toBe('desc');
  });
});
