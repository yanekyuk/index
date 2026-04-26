import { describe, expect, test } from 'bun:test';

import { runSetup as setup } from '../setup/setup.cli.js';

interface FakeCtx {
  ctx: Parameters<typeof setup>[0];
  configWrites: Array<{ path: string; value: unknown }>;
  promptCalls: Array<{ label: string; opts?: { default?: string; secret?: boolean } }>;
  selectCalls: Array<{ label: string; choices: Array<{ label: string; value: string }> }>;
}

function buildFakeCtx(overrides?: {
  channels?: Record<string, unknown>;
  /** Existing plugin config values — simulates a prior setup run. */
  existingConfig?: Record<string, string>;
  promptResponses?: Record<string, string>;
  /** Per-label select responses. Unspecified labels fall back to the first choice. */
  selectResponses?: Record<string, string>;
  /** Agent id returned by the fake /agents/me lookup. */
  resolvedAgentId?: string;
  /** Throw from fetchAgentId to simulate auth/network failure. */
  fetchAgentIdError?: Error;
}): FakeCtx & { fetchAgentIdCalls: Array<{ protocolUrl: string; apiKey: string }> } {
  const configWrites: FakeCtx['configWrites'] = [];
  const promptCalls: FakeCtx['promptCalls'] = [];
  const selectCalls: FakeCtx['selectCalls'] = [];
  const fetchAgentIdCalls: Array<{ protocolUrl: string; apiKey: string }> = [];

  const promptResponses = overrides?.promptResponses || {};

  const existingConfig = overrides?.existingConfig || {};
  const cfg: Record<string, unknown> = {
    channels: overrides?.channels || {},
  };
  if (Object.keys(existingConfig).length > 0) {
    cfg.plugins = {
      entries: {
        'indexnetwork-openclaw-plugin': {
          config: existingConfig,
        },
      },
    };
  }

  const ctx: Parameters<typeof setup>[0] = {
    cfg,
    prompt: async (label, opts) => {
      promptCalls.push({ label, opts });
      if (promptResponses[label] !== undefined) return promptResponses[label];
      if (opts?.default) return opts.default;
      return '';
    },
    select: async (label, choices) => {
      selectCalls.push({ label, choices });
      return overrides?.selectResponses?.[label] ?? choices[0].value;
    },
    configSet: async (path, value) => {
      configWrites.push({ path, value });
    },
    fetchAgentId: async (protocolUrl, apiKey) => {
      fetchAgentIdCalls.push({ protocolUrl, apiKey });
      if (overrides?.fetchAgentIdError) throw overrides.fetchAgentIdError;
      return overrides?.resolvedAgentId ?? 'agent-resolved-default';
    },
  };

  return { ctx, configWrites, promptCalls, selectCalls, fetchAgentIdCalls };
}

describe('setup wizard', () => {
  test('writes core config and MCP server with defaults', async () => {
    const fake = buildFakeCtx({
      promptResponses: { 'API key': 'key-456' },
      selectResponses: { 'Daily digest': 'true' },
      resolvedAgentId: 'agent-from-key',
    });

    await setup(fake.ctx);

    const paths = fake.configWrites.map((w) => w.path);
    expect(paths).toContain('plugins.entries.indexnetwork-openclaw-plugin.config.url');
    expect(paths).toContain('plugins.entries.indexnetwork-openclaw-plugin.config.agentId');
    expect(paths).toContain('plugins.entries.indexnetwork-openclaw-plugin.config.apiKey');
    expect(paths).toContain('mcp.servers.index-network');

    const urlWrite = fake.configWrites.find(
      (w) => w.path === 'plugins.entries.indexnetwork-openclaw-plugin.config.url',
    );
    expect(urlWrite?.value).toBe('https://index.network');

    const agentWrite = fake.configWrites.find(
      (w) => w.path === 'plugins.entries.indexnetwork-openclaw-plugin.config.agentId',
    );
    expect(agentWrite?.value).toBe('agent-from-key');

    expect(fake.fetchAgentIdCalls).toEqual([
      { protocolUrl: 'https://protocol.index.network', apiKey: 'key-456' },
    ]);

    const mcpWrite = fake.configWrites.find((w) => w.path === 'mcp.servers.index-network');
    expect(mcpWrite?.value).toEqual({
      url: 'https://protocol.index.network/mcp',
      transport: 'streamable-http',
      headers: { 'x-api-key': 'key-456' },
    });
  });

  test('does not prompt for Agent ID', async () => {
    const fake = buildFakeCtx({
      promptResponses: { 'API key': 'key-456' },
      selectResponses: { 'Daily digest': 'true' },
    });

    await setup(fake.ctx);

    expect(fake.promptCalls.find((p) => p.label === 'Agent ID')).toBeUndefined();
  });

  test('uses custom URL when provided', async () => {
    const fake = buildFakeCtx({
      promptResponses: {
        'Index Network URL': 'https://dev.index.network',
        'API key': 'key-456',
      },
      selectResponses: { 'Daily digest': 'true' },
    });

    await setup(fake.ctx);

    const urlWrite = fake.configWrites.find(
      (w) => w.path === 'plugins.entries.indexnetwork-openclaw-plugin.config.url',
    );
    expect(urlWrite?.value).toBe('https://dev.index.network');

    const mcpWrite = fake.configWrites.find((w) => w.path === 'mcp.servers.index-network');
    expect((mcpWrite?.value as { url: string }).url).toBe('https://protocol.dev.index.network/mcp');
  });

  test('migrates legacy protocolUrl to url on re-run', async () => {
    const fake = buildFakeCtx({
      existingConfig: { protocolUrl: 'https://protocol.dev.index.network' },
      promptResponses: { 'API key': 'key-456' },
      selectResponses: { 'Daily digest': 'true' },
    });

    await setup(fake.ctx);

    const urlPrompt = fake.promptCalls.find((p) => p.label === 'Index Network URL');
    expect(urlPrompt?.opts?.default).toBe('https://dev.index.network');

    const urlWrite = fake.configWrites.find(
      (w) => w.path === 'plugins.entries.indexnetwork-openclaw-plugin.config.url',
    );
    expect(urlWrite?.value).toBe('https://dev.index.network');

    const protocolUrlClear = fake.configWrites.find(
      (w) => w.path === 'plugins.entries.indexnetwork-openclaw-plugin.config.protocolUrl',
    );
    expect(protocolUrlClear?.value).toBeUndefined();
  });

  test('throws if API key is empty', async () => {
    const fake = buildFakeCtx({
      promptResponses: { 'API key': '' },
    });

    await expect(setup(fake.ctx)).rejects.toThrow('API key is required');
  });

  test('surfaces fetchAgentId errors', async () => {
    const fake = buildFakeCtx({
      promptResponses: { 'API key': 'key-456' },
      fetchAgentIdError: new Error('Could not resolve agent from API key (HTTP 401).'),
    });

    await expect(setup(fake.ctx)).rejects.toThrow('Could not resolve agent from API key');
  });

  test('prompts API key with secret flag', async () => {
    const fake = buildFakeCtx({
      promptResponses: { 'API key': 'key-456' },
      selectResponses: { 'Daily digest': 'true' },
    });

    await setup(fake.ctx);

    const apiKeyPrompt = fake.promptCalls.find((p) => p.label === 'API key');
    expect(apiKeyPrompt?.opts?.secret).toBe(true);
  });

  test('never prompts for delivery channel regardless of configured channels', async () => {
    // Even when channels are configured, the wizard no longer asks about delivery
    const fake = buildFakeCtx({
      channels: {
        telegram: { token: 'bot-token-123' },
        discord: { token: 'discord-token' },
      },
      promptResponses: { 'API key': 'key-456' },
      selectResponses: { 'Daily digest': 'true' },
    });

    await setup(fake.ctx);

    const deliverySelect = fake.selectCalls.find((s) => s.label === 'Delivery channel');
    expect(deliverySelect).toBeUndefined();

    const paths = fake.configWrites.map((w) => w.path);
    expect(paths).not.toContain('plugins.entries.indexnetwork-openclaw-plugin.config.deliveryChannel');
    expect(paths).not.toContain('plugins.entries.indexnetwork-openclaw-plugin.config.deliveryTarget');
  });

  test('never writes deliveryChannel or deliveryTarget even with no channels', async () => {
    const fake = buildFakeCtx({
      channels: {},
      promptResponses: { 'API key': 'key-456' },
      selectResponses: { 'Daily digest': 'true' },
    });

    await setup(fake.ctx);

    const deliverySelect = fake.selectCalls.find((s) => s.label === 'Delivery channel');
    expect(deliverySelect).toBeUndefined();

    const paths = fake.configWrites.map((w) => w.path);
    expect(paths).not.toContain('plugins.entries.indexnetwork-openclaw-plugin.config.deliveryChannel');
  });

  test('existing deliveryChannel and deliveryTarget in config do not break the wizard', async () => {
    // Pre-existing delivery config is left untouched — wizard neither reads nor writes it
    const fake = buildFakeCtx({
      existingConfig: { deliveryChannel: 'telegram', deliveryTarget: '12345' },
      promptResponses: { 'API key': 'key-456' },
      selectResponses: { 'Daily digest': 'true' },
    });

    await setup(fake.ctx);

    // Wizard completes without error
    const paths = fake.configWrites.map((w) => w.path);
    expect(paths).toContain('plugins.entries.indexnetwork-openclaw-plugin.config.url');
    expect(paths).toContain('plugins.entries.indexnetwork-openclaw-plugin.config.apiKey');
    // Not overwritten
    expect(paths).not.toContain('plugins.entries.indexnetwork-openclaw-plugin.config.deliveryChannel');
    expect(paths).not.toContain('plugins.entries.indexnetwork-openclaw-plugin.config.deliveryTarget');
  });

  // --- Main agent tool use ---

  test('prompts for mainAgentToolUse and writes disabled by default', async () => {
    const fake = buildFakeCtx({
      promptResponses: { 'API key': 'key-456' },
      selectResponses: { 'Daily digest': 'true' },
      // No selectResponse for mainAgentToolUse — falls back to first choice ('disabled')
    });

    await setup(fake.ctx);

    const mainAgentSelect = fake.selectCalls.find(
      (s) => s.label === 'Main agent tool use during Index Network renders',
    );
    expect(mainAgentSelect).toBeDefined();

    const mainAgentWrite = fake.configWrites.find(
      (w) => w.path === 'plugins.entries.indexnetwork-openclaw-plugin.config.mainAgentToolUse',
    );
    expect(mainAgentWrite?.value).toBe('disabled');
  });

  test('writes mainAgentToolUse enabled when user picks enabled', async () => {
    const fake = buildFakeCtx({
      promptResponses: { 'API key': 'key-456' },
      selectResponses: {
        'Daily digest': 'true',
        'Main agent tool use during Index Network renders': 'enabled',
      },
    });

    await setup(fake.ctx);

    const mainAgentWrite = fake.configWrites.find(
      (w) => w.path === 'plugins.entries.indexnetwork-openclaw-plugin.config.mainAgentToolUse',
    );
    expect(mainAgentWrite?.value).toBe('enabled');
  });

  test('mainAgentToolUse prompt appears after digest config and before MCP registration', async () => {
    const fake = buildFakeCtx({
      promptResponses: { 'API key': 'key-456' },
      selectResponses: { 'Daily digest': 'true' },
    });

    await setup(fake.ctx);

    const selectLabels = fake.selectCalls.map((s) => s.label);
    const digestIdx = selectLabels.indexOf('Daily digest');
    const mainAgentIdx = selectLabels.indexOf('Main agent tool use during Index Network renders');
    expect(digestIdx).toBeGreaterThanOrEqual(0);
    expect(mainAgentIdx).toBeGreaterThan(digestIdx);

    // MCP write comes after mainAgentToolUse write in configWrites
    const paths = fake.configWrites.map((w) => w.path);
    const mainAgentWriteIdx = paths.indexOf(
      'plugins.entries.indexnetwork-openclaw-plugin.config.mainAgentToolUse',
    );
    const mcpWriteIdx = paths.indexOf('mcp.servers.index-network');
    expect(mainAgentWriteIdx).toBeGreaterThanOrEqual(0);
    expect(mcpWriteIdx).toBeGreaterThan(mainAgentWriteIdx);
  });

  // --- Digest config ---

  test('writes digest config with default time and count when not overridden', async () => {
    const fake = buildFakeCtx({
      promptResponses: { 'API key': 'key-456' },
      selectResponses: { 'Daily digest': 'true' },
    });

    await setup(fake.ctx);

    const paths = fake.configWrites.map((w) => w.path);
    expect(paths).toContain('plugins.entries.indexnetwork-openclaw-plugin.config.digestEnabled');
    expect(paths).toContain('plugins.entries.indexnetwork-openclaw-plugin.config.digestTime');
    expect(paths).toContain('plugins.entries.indexnetwork-openclaw-plugin.config.digestMaxCount');

    expect(fake.configWrites.find((w) => w.path.endsWith('digestEnabled'))?.value).toBe('true');
    expect(fake.configWrites.find((w) => w.path.endsWith('digestTime'))?.value).toBe('08:00');
    expect(fake.configWrites.find((w) => w.path.endsWith('digestMaxCount'))?.value).toBe('20');
  });

  test('digestMaxCount default is 20', async () => {
    const fake = buildFakeCtx({
      promptResponses: { 'API key': 'key-456' },
      selectResponses: { 'Daily digest': 'true' },
    });

    await setup(fake.ctx);

    const digestMaxPrompt = fake.promptCalls.find((p) => p.label === 'Max opportunities per digest');
    expect(digestMaxPrompt?.opts?.default).toBe('20');
  });

  test('writes custom digest time and count when provided', async () => {
    const fake = buildFakeCtx({
      promptResponses: {
        'Agent ID': 'agent-123',
        'API key': 'key-456',
        'Digest time (HH:MM, 24-hour local time)': '09:30',
        'Max opportunities per digest': '5',
      },
      selectResponses: { 'Daily digest': 'true' },
    });

    await setup(fake.ctx);

    expect(fake.configWrites.find((w) => w.path.endsWith('digestTime'))?.value).toBe('09:30');
    expect(fake.configWrites.find((w) => w.path.endsWith('digestMaxCount'))?.value).toBe('5');
  });

  test('skips digest time and count prompts when digest is disabled', async () => {
    const fake = buildFakeCtx({
      promptResponses: {
        'Agent ID': 'agent-123',
        'API key': 'key-456',
      },
      selectResponses: { 'Daily digest': 'false' },
    });

    await setup(fake.ctx);

    const paths = fake.configWrites.map((w) => w.path);
    expect(paths).toContain('plugins.entries.indexnetwork-openclaw-plugin.config.digestEnabled');
    expect(fake.configWrites.find((w) => w.path.endsWith('digestEnabled'))?.value).toBe('false');
    expect(paths).not.toContain('plugins.entries.indexnetwork-openclaw-plugin.config.digestTime');
    expect(paths).not.toContain('plugins.entries.indexnetwork-openclaw-plugin.config.digestMaxCount');
  });

  test('uses existing digest config as defaults when re-running setup', async () => {
    const fake = buildFakeCtx({
      existingConfig: { digestEnabled: 'true', digestTime: '07:00', digestMaxCount: '3' },
      promptResponses: {
        'Agent ID': 'agent-123',
        'API key': 'key-456',
      },
      selectResponses: { 'Daily digest': 'true' },
    });

    await setup(fake.ctx);

    const digestSelect = fake.selectCalls.find((s) => s.label === 'Daily digest');
    expect(digestSelect).toBeDefined();

    // Existing values surfaced as defaults so pressing Enter keeps them
    const digestTimePrompt = fake.promptCalls.find((p) => p.label === 'Digest time (HH:MM, 24-hour local time)');
    expect(digestTimePrompt?.opts?.default).toBe('07:00');

    const digestMaxPrompt = fake.promptCalls.find((p) => p.label === 'Max opportunities per digest');
    expect(digestMaxPrompt?.opts?.default).toBe('3');

    expect(fake.configWrites.find((w) => w.path.endsWith('digestTime'))?.value).toBe('07:00');
    expect(fake.configWrites.find((w) => w.path.endsWith('digestMaxCount'))?.value).toBe('3');
  });

  // --- Hooks bootstrap ---

  test('bootstraps hooks: writes hooks.enabled=true, generates hooks.token, sets hooks.path=/hooks', async () => {
    const fake = buildFakeCtx({
      promptResponses: { 'API key': 'key-456' },
      selectResponses: { 'Daily digest': 'true' },
    });

    await setup(fake.ctx);

    const enabledWrite = fake.configWrites.find((w) => w.path === 'hooks.enabled');
    expect(enabledWrite?.value).toBe(true);

    const tokenWrite = fake.configWrites.find((w) => w.path === 'hooks.token');
    expect(typeof tokenWrite?.value).toBe('string');
    expect((tokenWrite?.value as string).length).toBeGreaterThanOrEqual(32);

    const pathWrite = fake.configWrites.find((w) => w.path === 'hooks.path');
    expect(pathWrite?.value).toBe('/hooks');
  });

  test('preserves existing hooks.token when present', async () => {
    const fake = buildFakeCtx({
      promptResponses: { 'API key': 'key-456' },
      selectResponses: { 'Daily digest': 'true' },
    });
    fake.ctx.cfg.hooks = { enabled: true, token: 'existing-token-abc', path: '/hooks' };

    await setup(fake.ctx);

    // No new hooks.token write because the existing one is preserved
    const tokenWrites = fake.configWrites.filter((w) => w.path === 'hooks.token');
    expect(tokenWrites).toHaveLength(0);
    // hooks.enabled also not rewritten when already true
    const enabledWrites = fake.configWrites.filter((w) => w.path === 'hooks.enabled');
    expect(enabledWrites).toHaveLength(0);
    const pathWrites = fake.configWrites.filter((w) => w.path === 'hooks.path');
    expect(pathWrites).toHaveLength(0);
  });

  test('flips hooks.enabled to true when previously false', async () => {
    const fake = buildFakeCtx({
      promptResponses: { 'API key': 'key-456' },
      selectResponses: { 'Daily digest': 'true' },
    });
    fake.ctx.cfg.hooks = { enabled: false };

    await setup(fake.ctx);

    const enabledWrite = fake.configWrites.find((w) => w.path === 'hooks.enabled');
    expect(enabledWrite?.value).toBe(true);
    const tokenWrite = fake.configWrites.find((w) => w.path === 'hooks.token');
    expect(typeof tokenWrite?.value).toBe('string');
  });

  test('rejects when existing hooks.token equals gateway.auth.token', async () => {
    const fake = buildFakeCtx({
      promptResponses: { 'API key': 'key-456' },
      selectResponses: { 'Daily digest': 'true' },
    });
    fake.ctx.cfg.gateway = { auth: { token: 'shared-secret' } };
    fake.ctx.cfg.hooks = { enabled: true, token: 'shared-secret' };

    await expect(setup(fake.ctx)).rejects.toThrow('hooks.token must be distinct');
  });

  test('generates a fresh hooks.token (does not reuse gateway.auth.token) when starting from scratch', async () => {
    const fake = buildFakeCtx({
      promptResponses: { 'API key': 'key-456' },
      selectResponses: { 'Daily digest': 'true' },
    });
    fake.ctx.cfg.gateway = { auth: { token: 'gateway-tok' } };

    await setup(fake.ctx);

    const tokenWrite = fake.configWrites.find((w) => w.path === 'hooks.token');
    expect(tokenWrite?.value).not.toBe('gateway-tok');
    expect(typeof tokenWrite?.value).toBe('string');
  });

  // --- Hooks session-key bootstrap ---

  test('bootstraps hooks.allowRequestSessionKey=true when unset', async () => {
    const fake = buildFakeCtx({
      promptResponses: { 'API key': 'key-456' },
      selectResponses: { 'Daily digest': 'true' },
    });

    await setup(fake.ctx);

    const allowWrite = fake.configWrites.find(
      (w) => w.path === 'hooks.allowRequestSessionKey',
    );
    expect(allowWrite?.value).toBe(true);
  });

  test('does not rewrite hooks.allowRequestSessionKey when already true', async () => {
    const fake = buildFakeCtx({
      promptResponses: { 'API key': 'key-456' },
      selectResponses: { 'Daily digest': 'true' },
    });
    fake.ctx.cfg.hooks = {
      enabled: true,
      token: 'existing-token-abc',
      path: '/hooks',
      allowRequestSessionKey: true,
    };

    await setup(fake.ctx);

    const allowWrites = fake.configWrites.filter(
      (w) => w.path === 'hooks.allowRequestSessionKey',
    );
    expect(allowWrites).toHaveLength(0);
  });

  test('seeds hooks.allowedSessionKeyPrefixes with agent:main: when unset', async () => {
    const fake = buildFakeCtx({
      promptResponses: { 'API key': 'key-456' },
      selectResponses: { 'Daily digest': 'true' },
    });

    await setup(fake.ctx);

    const prefixesWrite = fake.configWrites.find(
      (w) => w.path === 'hooks.allowedSessionKeyPrefixes',
    );
    expect(prefixesWrite?.value).toEqual(['agent:main:']);
  });

  test('appends agent:main: to existing hooks.allowedSessionKeyPrefixes, preserving entries', async () => {
    const fake = buildFakeCtx({
      promptResponses: { 'API key': 'key-456' },
      selectResponses: { 'Daily digest': 'true' },
    });
    fake.ctx.cfg.hooks = {
      enabled: true,
      token: 'tok',
      path: '/hooks',
      allowedSessionKeyPrefixes: ['hook:', 'custom:'],
    };

    await setup(fake.ctx);

    const prefixesWrite = fake.configWrites.find(
      (w) => w.path === 'hooks.allowedSessionKeyPrefixes',
    );
    expect(prefixesWrite?.value).toEqual(['hook:', 'custom:', 'agent:main:']);
  });

  test('does not rewrite hooks.allowedSessionKeyPrefixes when agent:main: already present', async () => {
    const fake = buildFakeCtx({
      promptResponses: { 'API key': 'key-456' },
      selectResponses: { 'Daily digest': 'true' },
    });
    fake.ctx.cfg.hooks = {
      enabled: true,
      token: 'tok',
      path: '/hooks',
      allowedSessionKeyPrefixes: ['hook:', 'agent:main:'],
    };

    await setup(fake.ctx);

    const prefixesWrites = fake.configWrites.filter(
      (w) => w.path === 'hooks.allowedSessionKeyPrefixes',
    );
    expect(prefixesWrites).toHaveLength(0);
  });

  test('re-resolves agentId from API key on re-run, ignoring existing config', async () => {
    const fake = buildFakeCtx({
      existingConfig: { agentId: 'stale-agent-456' },
      promptResponses: { 'API key': 'key-789' },
      selectResponses: { 'Daily digest': 'true' },
      resolvedAgentId: 'fresh-agent-from-key',
    });

    await setup(fake.ctx);

    const agentWrite = fake.configWrites.find(
      (w) => w.path === 'plugins.entries.indexnetwork-openclaw-plugin.config.agentId',
    );
    expect(agentWrite?.value).toBe('fresh-agent-from-key');
  });
});
