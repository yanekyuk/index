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
}): FakeCtx {
  const configWrites: FakeCtx['configWrites'] = [];
  const promptCalls: FakeCtx['promptCalls'] = [];
  const selectCalls: FakeCtx['selectCalls'] = [];

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
  };

  return { ctx, configWrites, promptCalls, selectCalls };
}

describe('setup wizard', () => {
  test('writes core config and MCP server with defaults', async () => {
    const fake = buildFakeCtx({
      promptResponses: {
        'Agent ID': 'agent-123',
        'API key': 'key-456',
      },
      selectResponses: { 'Daily digest': 'true' },
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

    const mcpWrite = fake.configWrites.find((w) => w.path === 'mcp.servers.index-network');
    expect(mcpWrite?.value).toEqual({
      url: 'https://protocol.index.network/mcp',
      transport: 'streamable-http',
      headers: { 'x-api-key': 'key-456' },
    });
  });

  test('uses custom URL when provided', async () => {
    const fake = buildFakeCtx({
      promptResponses: {
        'Index Network URL': 'https://dev.index.network',
        'Agent ID': 'agent-123',
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
      promptResponses: {
        'Agent ID': 'agent-123',
        'API key': 'key-456',
      },
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

  test('throws if Agent ID is empty', async () => {
    const fake = buildFakeCtx({
      promptResponses: {
        'Agent ID': '',
        'API key': 'key-456',
      },
    });

    await expect(setup(fake.ctx)).rejects.toThrow('Agent ID is required');
  });

  test('throws if API key is empty', async () => {
    const fake = buildFakeCtx({
      promptResponses: {
        'Agent ID': 'agent-123',
        'API key': '',
      },
    });

    await expect(setup(fake.ctx)).rejects.toThrow('API key is required');
  });

  test('prompts API key with secret flag', async () => {
    const fake = buildFakeCtx({
      promptResponses: {
        'Agent ID': 'agent-123',
        'API key': 'key-456',
      },
      selectResponses: { 'Daily digest': 'true' },
    });

    await setup(fake.ctx);

    const apiKeyPrompt = fake.promptCalls.find((p) => p.label === 'API key');
    expect(apiKeyPrompt?.opts?.secret).toBe(true);
  });

  test('skips delivery when no channels are configured', async () => {
    const fake = buildFakeCtx({
      channels: {},
      promptResponses: {
        'Agent ID': 'agent-123',
        'API key': 'key-456',
      },
      selectResponses: { 'Daily digest': 'true' },
    });

    await setup(fake.ctx);

    const deliverySelect = fake.selectCalls.find((s) => s.label === 'Delivery channel');
    expect(deliverySelect).toBeUndefined();

    const paths = fake.configWrites.map((w) => w.path);
    expect(paths).not.toContain('plugins.entries.indexnetwork-openclaw-plugin.config.deliveryChannel');
  });

  test('offers detected channels and writes delivery config when selected', async () => {
    const fake = buildFakeCtx({
      channels: {
        telegram: { token: 'bot-token-123' },
        discord: { token: 'discord-token' },
      },
      promptResponses: {
        'Agent ID': 'agent-123',
        'API key': 'key-456',
        'Telegram chat ID (message @userinfobot on Telegram to find yours)': '99887766',
      },
      selectResponses: {
        'Delivery channel': 'telegram',
        'Daily digest': 'true',
      },
    });

    await setup(fake.ctx);

    const deliverySelect = fake.selectCalls.find((s) => s.label === 'Delivery channel');
    expect(deliverySelect).toBeDefined();
    const choices = deliverySelect!.choices;
    expect(choices.map((c) => c.value)).toContain('telegram');
    expect(choices.map((c) => c.value)).toContain('discord');
    expect(choices.map((c) => c.value)).toContain('');

    const channelWrite = fake.configWrites.find(
      (w) => w.path === 'plugins.entries.indexnetwork-openclaw-plugin.config.deliveryChannel',
    );
    expect(channelWrite?.value).toBe('telegram');

    const targetWrite = fake.configWrites.find(
      (w) => w.path === 'plugins.entries.indexnetwork-openclaw-plugin.config.deliveryTarget',
    );
    expect(targetWrite?.value).toBe('99887766');
  });

  test('skips delivery config when user selects Skip', async () => {
    const fake = buildFakeCtx({
      channels: { telegram: { token: 'bot-token' } },
      promptResponses: {
        'Agent ID': 'agent-123',
        'API key': 'key-456',
      },
      selectResponses: {
        'Delivery channel': '',
        'Daily digest': 'true',
      },
    });

    await setup(fake.ctx);

    const paths = fake.configWrites.map((w) => w.path);
    expect(paths).not.toContain('plugins.entries.indexnetwork-openclaw-plugin.config.deliveryChannel');
    expect(paths).not.toContain('plugins.entries.indexnetwork-openclaw-plugin.config.deliveryTarget');
  });

  // --- Digest config ---

  test('writes digest config with default time and count when not overridden', async () => {
    const fake = buildFakeCtx({
      promptResponses: {
        'Agent ID': 'agent-123',
        'API key': 'key-456',
      },
      selectResponses: { 'Daily digest': 'true' },
    });

    await setup(fake.ctx);

    const paths = fake.configWrites.map((w) => w.path);
    expect(paths).toContain('plugins.entries.indexnetwork-openclaw-plugin.config.digestEnabled');
    expect(paths).toContain('plugins.entries.indexnetwork-openclaw-plugin.config.digestTime');
    expect(paths).toContain('plugins.entries.indexnetwork-openclaw-plugin.config.digestMaxCount');

    expect(fake.configWrites.find((w) => w.path.endsWith('digestEnabled'))?.value).toBe('true');
    expect(fake.configWrites.find((w) => w.path.endsWith('digestTime'))?.value).toBe('08:00');
    expect(fake.configWrites.find((w) => w.path.endsWith('digestMaxCount'))?.value).toBe('10');
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

  test('uses existing agentId as default when re-running setup', async () => {
    const fake = buildFakeCtx({
      existingConfig: { agentId: 'existing-agent-456' },
      promptResponses: {
        'API key': 'key-789',
      },
      selectResponses: { 'Daily digest': 'true' },
    });

    await setup(fake.ctx);

    const agentIdPrompt = fake.promptCalls.find((p) => p.label === 'Agent ID');
    expect(agentIdPrompt?.opts?.default).toBe('existing-agent-456');

    const agentWrite = fake.configWrites.find(
      (w) => w.path === 'plugins.entries.indexnetwork-openclaw-plugin.config.agentId',
    );
    expect(agentWrite?.value).toBe('existing-agent-456');
  });

  test('shows delivery section with existing config as defaults when re-running setup', async () => {
    const fake = buildFakeCtx({
      channels: { telegram: { token: 'bot-token' } },
      existingConfig: { deliveryChannel: 'telegram', deliveryTarget: '12345' },
      promptResponses: {
        'Agent ID': 'agent-123',
        'API key': 'key-456',
      },
      selectResponses: {
        'Delivery channel': 'telegram',
        'Daily digest': 'true',
      },
    });

    await setup(fake.ctx);

    const deliverySelect = fake.selectCalls.find((s) => s.label === 'Delivery channel');
    expect(deliverySelect).toBeDefined();

    // Existing channel annotated as (current)
    const telegramChoice = deliverySelect!.choices.find((c) => c.value === 'telegram');
    expect(telegramChoice?.label).toContain('(current)');

    // Existing target surfaced as default so pressing Enter keeps it
    const targetPrompt = fake.promptCalls.find(
      (p) => p.label === 'Telegram chat ID (message @userinfobot on Telegram to find yours)',
    );
    expect(targetPrompt?.opts?.default).toBe('12345');
  });
});
