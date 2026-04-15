import { describe, expect, test } from 'bun:test';

import { runSetup as setup } from '../setup.cli.js';

interface FakeCtx {
  ctx: Parameters<typeof setup>[0];
  configWrites: Array<{ path: string; value: unknown }>;
  promptCalls: Array<{ label: string; opts?: { default?: string; secret?: boolean } }>;
  selectCalls: Array<{ label: string; choices: Array<{ label: string; value: string }> }>;
}

function buildFakeCtx(overrides?: {
  channels?: Record<string, unknown>;
  promptResponses?: Record<string, string>;
  selectResponse?: string;
}): FakeCtx {
  const configWrites: FakeCtx['configWrites'] = [];
  const promptCalls: FakeCtx['promptCalls'] = [];
  const selectCalls: FakeCtx['selectCalls'] = [];

  const promptResponses = overrides?.promptResponses || {};
  const selectResponse = overrides?.selectResponse ?? '';

  const ctx: Parameters<typeof setup>[0] = {
    cfg: {
      channels: overrides?.channels || {},
    },
    prompt: async (label, opts) => {
      promptCalls.push({ label, opts });
      if (promptResponses[label] !== undefined) return promptResponses[label];
      if (opts?.default) return opts.default;
      return '';
    },
    select: async (label, choices) => {
      selectCalls.push({ label, choices });
      return selectResponse;
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
    });

    await setup(fake.ctx);

    const paths = fake.configWrites.map((w) => w.path);
    expect(paths).toContain('plugins.entries.indexnetwork-openclaw-plugin.config.protocolUrl');
    expect(paths).toContain('plugins.entries.indexnetwork-openclaw-plugin.config.agentId');
    expect(paths).toContain('plugins.entries.indexnetwork-openclaw-plugin.config.apiKey');
    expect(paths).toContain('mcp.servers.index-network');

    const protocolWrite = fake.configWrites.find(
      (w) => w.path === 'plugins.entries.indexnetwork-openclaw-plugin.config.protocolUrl',
    );
    expect(protocolWrite?.value).toBe('https://protocol.index.network');

    const mcpWrite = fake.configWrites.find((w) => w.path === 'mcp.servers.index-network');
    expect(mcpWrite?.value).toEqual({
      url: 'https://protocol.index.network/mcp',
      transport: 'streamable-http',
      headers: { 'x-api-key': 'key-456' },
    });
  });

  test('uses custom server URL when provided', async () => {
    const fake = buildFakeCtx({
      promptResponses: {
        'Server URL': 'http://localhost:3001',
        'Agent ID': 'agent-123',
        'API key': 'key-456',
      },
    });

    await setup(fake.ctx);

    const protocolWrite = fake.configWrites.find(
      (w) => w.path === 'plugins.entries.indexnetwork-openclaw-plugin.config.protocolUrl',
    );
    expect(protocolWrite?.value).toBe('http://localhost:3001');

    const mcpWrite = fake.configWrites.find((w) => w.path === 'mcp.servers.index-network');
    expect((mcpWrite?.value as { url: string }).url).toBe('http://localhost:3001/mcp');
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
    });

    await setup(fake.ctx);

    expect(fake.selectCalls.length).toBe(0);
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
        'Telegram chat ID': '99887766',
      },
      selectResponse: 'telegram',
    });

    await setup(fake.ctx);

    expect(fake.selectCalls.length).toBe(1);
    const choices = fake.selectCalls[0].choices;
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
      selectResponse: '',
    });

    await setup(fake.ctx);

    const paths = fake.configWrites.map((w) => w.path);
    expect(paths).not.toContain('plugins.entries.indexnetwork-openclaw-plugin.config.deliveryChannel');
    expect(paths).not.toContain('plugins.entries.indexnetwork-openclaw-plugin.config.deliveryTarget');
  });
});
