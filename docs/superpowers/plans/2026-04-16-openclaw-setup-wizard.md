# OpenClaw Setup Wizard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace 4 manual CLI setup commands with a single `openclaw plugins install` that runs an interactive setup wizard and auto-registers the MCP server.

**Architecture:** Add a `setup-entry.ts` using OpenClaw's `setupEntry` mechanism for interactive onboarding. Extend `register()` in `index.ts` to auto-register/sync the MCP server definition on every startup. Simplify the frontend `SetupInstructions` component from 4 code blocks to 1 install command + copy-able values.

**Tech Stack:** TypeScript, OpenClaw plugin SDK (`defineSetupPluginEntry`, config API), React (frontend)

**Spec:** `docs/superpowers/specs/2026-04-16-openclaw-setup-wizard-design.md`

---

### Task 1: Add `setup-entry.ts` — the interactive setup wizard

**Files:**
- Create: `packages/openclaw-plugin/src/setup-entry.ts`

This is the core deliverable. The setup entry uses `defineSetupPluginEntry` (or a compatible export shape) to define an interactive wizard that collects `protocolUrl`, `agentId`, `apiKey`, delivery channel, and delivery target.

- [ ] **Step 1: Create `setup-entry.ts` with the wizard implementation**

```typescript
/**
 * Index Network — OpenClaw setup entry point.
 *
 * Interactive wizard that runs during `openclaw plugins install` or
 * `openclaw configure`. Collects protocolUrl, agentId, apiKey, and
 * optional delivery routing, then writes plugin config and registers
 * the MCP server.
 */

const PLUGIN_ID = 'indexnetwork-openclaw-plugin';
const DEFAULT_PROTOCOL_URL = 'https://protocol.index.network';

/** Human-readable labels for known channel IDs. */
const CHANNEL_LABELS: Record<string, string> = {
  telegram: 'Telegram',
  discord: 'Discord',
  slack: 'Slack',
  whatsapp: 'WhatsApp',
  signal: 'Signal',
  matrix: 'Matrix',
};

/** Channel-specific prompts for the delivery target input. */
const TARGET_PROMPTS: Record<string, string> = {
  telegram: 'Telegram chat ID',
  discord: 'Discord channel ID',
  slack: 'Slack channel ID',
  whatsapp: 'WhatsApp number',
  signal: 'Signal number',
  matrix: 'Matrix room ID',
};

interface SetupContext {
  /** Full OpenClaw config snapshot. */
  cfg: Record<string, unknown>;
  /** Prompt the user for free-text input. */
  prompt(label: string, opts?: { default?: string; secret?: boolean }): Promise<string>;
  /** Prompt the user to select from a list. Returns the selected value. */
  select(label: string, choices: Array<{ label: string; value: string }>): Promise<string>;
  /** Write a value into the OpenClaw config file. */
  configSet(path: string, value: unknown): Promise<void>;
}

export default async function setup(ctx: SetupContext): Promise<void> {
  // --- Server URL ---
  const protocolUrl = await ctx.prompt('Server URL', {
    default: DEFAULT_PROTOCOL_URL,
  });

  // --- Agent ID ---
  const agentId = await ctx.prompt('Agent ID');
  if (!agentId) {
    throw new Error('Agent ID is required. Find it on the Index Network Agents page.');
  }

  // --- API Key ---
  const apiKey = await ctx.prompt('API key', { secret: true });
  if (!apiKey) {
    throw new Error('API key is required. Generate one on the Index Network Agents page.');
  }

  // --- Write core config ---
  const configPrefix = `plugins.entries.${PLUGIN_ID}.config`;
  await ctx.configSet(`${configPrefix}.protocolUrl`, protocolUrl);
  await ctx.configSet(`${configPrefix}.agentId`, agentId);
  await ctx.configSet(`${configPrefix}.apiKey`, apiKey);

  // --- Detect available delivery channels ---
  const channels = ctx.cfg.channels as Record<string, unknown> | undefined;
  const configuredChannels = Object.entries(channels || {})
    .filter(([, val]) => val && typeof val === 'object')
    .map(([id]) => id);

  if (configuredChannels.length > 0) {
    const choices = [
      ...configuredChannels.map((id) => ({
        label: CHANNEL_LABELS[id] || id,
        value: id,
      })),
      { label: 'Skip', value: '' },
    ];

    const selectedChannel = await ctx.select('Delivery channel', choices);

    if (selectedChannel) {
      const targetLabel = TARGET_PROMPTS[selectedChannel] || `${selectedChannel} recipient ID`;
      const deliveryTarget = await ctx.prompt(targetLabel);

      if (deliveryTarget) {
        await ctx.configSet(`${configPrefix}.deliveryChannel`, selectedChannel);
        await ctx.configSet(`${configPrefix}.deliveryTarget`, deliveryTarget);
      }
    }
  }

  // --- Register MCP server ---
  const mcpDef = {
    url: `${protocolUrl}/mcp`,
    transport: 'streamable-http',
    headers: { 'x-api-key': apiKey },
  };
  await ctx.configSet(`mcp.servers.index-network`, mcpDef);
}
```

- [ ] **Step 2: Run existing tests to make sure nothing is broken**

Run: `cd packages/openclaw-plugin && bun test`
Expected: All existing tests PASS

- [ ] **Step 3: Commit**

```bash
git add packages/openclaw-plugin/src/setup-entry.ts
git commit -m "feat(openclaw-plugin): add interactive setup wizard entry point"
```

---

### Task 2: Write tests for the setup wizard

**Files:**
- Create: `packages/openclaw-plugin/src/tests/setup-entry.spec.ts`

- [ ] **Step 1: Write tests covering all wizard paths**

```typescript
import { afterEach, describe, expect, mock, test } from 'bun:test';

import setup from '../setup-entry.js';

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

    // Should have offered both channels + Skip
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
```

- [ ] **Step 2: Run tests to verify they pass**

Run: `cd packages/openclaw-plugin && bun test src/tests/setup-entry.spec.ts`
Expected: All 7 tests PASS

- [ ] **Step 3: Commit**

```bash
git add packages/openclaw-plugin/src/tests/setup-entry.spec.ts
git commit -m "test(openclaw-plugin): add setup wizard tests"
```

---

### Task 3: Add auto MCP registration to `register()`

**Files:**
- Modify: `packages/openclaw-plugin/src/index.ts`
- Modify: `packages/openclaw-plugin/src/plugin-api.ts`

On every startup, `register()` should sync the MCP server definition from plugin config. This handles cases where the user changes `apiKey` or `protocolUrl` via `openclaw config set` after initial setup.

- [ ] **Step 1: Extend `OpenClawConfigSlice` in `plugin-api.ts` to include MCP servers**

Add the `mcp` field to `OpenClawConfigSlice` and add a `configSet` method to `OpenClawPluginApi`:

```typescript
// Add to OpenClawConfigSlice:
  mcp?: {
    servers?: Record<string, {
      url?: string;
      transport?: string;
      headers?: Record<string, string>;
    }>;
  };
```

```typescript
// Add to OpenClawPluginApi:
  /** Write a value into the OpenClaw config. Available since OpenClaw >=0.1.0. */
  configSet?(path: string, value: unknown): Promise<void>;
```

- [ ] **Step 2: Add `ensureMcpServer()` function to `index.ts`**

Add this function before `register()` and call it at the top of `register()` (after the `agentId`/`apiKey` check):

```typescript
/**
 * Ensures the `index-network` MCP server definition in OpenClaw config
 * matches the current plugin config. Creates or updates as needed.
 */
function ensureMcpServer(api: OpenClawPluginApi, baseUrl: string, apiKey: string): void {
  if (!api.configSet) {
    api.logger.debug('configSet not available — skipping MCP auto-registration.');
    return;
  }

  const expected = {
    url: `${baseUrl}/mcp`,
    transport: 'streamable-http',
    headers: { 'x-api-key': apiKey },
  };

  const current = api.config?.mcp?.servers?.['index-network'];
  const needsUpdate =
    !current ||
    current.url !== expected.url ||
    current.headers?.['x-api-key'] !== apiKey;

  if (needsUpdate) {
    api.configSet('mcp.servers.index-network', expected).catch((err) => {
      api.logger.warn(
        `Failed to auto-register MCP server: ${err instanceof Error ? err.message : String(err)}`,
      );
    });
    api.logger.info('Index Network MCP server registered/updated.');
  }
}
```

Then in `register()`, call it right after the `baseUrl` declaration (line 68 in current code):

```typescript
  const baseUrl = readConfig(api, 'protocolUrl') || 'https://protocol.index.network';

  ensureMcpServer(api, baseUrl, apiKey);
```

Note: also update the default from `'http://localhost:3001'` to `'https://protocol.index.network'` to match the new spec.

- [ ] **Step 3: Update the unconfigured warning message to mention `openclaw configure`**

Change the existing warning in `register()` (when `agentId` or `apiKey` is missing) from:

```typescript
    api.logger.warn(
      'Index Network polling requires agentId and apiKey in plugin config. Polling will not start.',
    );
```

to:

```typescript
    api.logger.warn(
      'Index Network plugin not configured. Run `openclaw configure` to complete setup.',
    );
```

- [ ] **Step 4: Run all tests**

Run: `cd packages/openclaw-plugin && bun test`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add packages/openclaw-plugin/src/index.ts packages/openclaw-plugin/src/plugin-api.ts
git commit -m "feat(openclaw-plugin): auto-register MCP server on startup"
```

---

### Task 4: Write tests for auto MCP registration

**Files:**
- Modify: `packages/openclaw-plugin/src/tests/index.spec.ts`

- [ ] **Step 1: Update `buildFakeApi` to support `configSet` and MCP config**

Add `configSet` mock and `mcp` config to the fake API builder. Replace the existing `buildFakeApi` function:

```typescript
interface FakeApi {
  api: OpenClawPluginApi;
  subagentCalls: SubagentRunOptions[];
  configSetCalls: Array<{ path: string; value: unknown }>;
  logger: { warn: ReturnType<typeof mock>; error: ReturnType<typeof mock>; info: ReturnType<typeof mock>; debug: ReturnType<typeof mock> };
}

function buildFakeApi(
  config: Record<string, unknown>,
  opts?: { mcpServers?: Record<string, unknown> },
): FakeApi {
  const subagentCalls: SubagentRunOptions[] = [];
  const configSetCalls: FakeApi['configSetCalls'] = [];
  const logger = {
    debug: mock(() => {}),
    info: mock(() => {}),
    warn: mock(() => {}),
    error: mock(() => {}),
  };

  const api: OpenClawPluginApi = {
    id: 'indexnetwork-openclaw-plugin',
    name: 'Index Network',
    pluginConfig: config,
    config: {
      mcp: { servers: (opts?.mcpServers || {}) as any },
    },
    runtime: {
      subagent: {
        run: async (o) => {
          subagentCalls.push(o);
          return { runId: 'fake-run-id' };
        },
      },
    },
    logger,
    registerHttpRoute: mock(() => {}),
    configSet: mock(async (path: string, value: unknown) => {
      configSetCalls.push({ path, value });
    }),
  };

  return { api, subagentCalls, configSetCalls, logger };
}
```

- [ ] **Step 2: Add tests for MCP auto-registration**

Append these tests to the existing `describe('register(api)')` block:

```typescript
  test('auto-registers MCP server when not present', () => {
    const fake = buildFakeApi(
      { agentId: 'agent-1', apiKey: 'key-1', protocolUrl: 'https://protocol.index.network' },
      { mcpServers: {} },
    );
    register(fake.api);

    expect(fake.configSetCalls.length).toBe(1);
    expect(fake.configSetCalls[0].path).toBe('mcp.servers.index-network');
    expect(fake.configSetCalls[0].value).toEqual({
      url: 'https://protocol.index.network/mcp',
      transport: 'streamable-http',
      headers: { 'x-api-key': 'key-1' },
    });
  });

  test('skips MCP registration when already correct', () => {
    const fake = buildFakeApi(
      { agentId: 'agent-1', apiKey: 'key-1', protocolUrl: 'https://protocol.index.network' },
      {
        mcpServers: {
          'index-network': {
            url: 'https://protocol.index.network/mcp',
            transport: 'streamable-http',
            headers: { 'x-api-key': 'key-1' },
          },
        },
      },
    );
    register(fake.api);

    expect(fake.configSetCalls.length).toBe(0);
  });

  test('updates MCP server when apiKey changes', () => {
    const fake = buildFakeApi(
      { agentId: 'agent-1', apiKey: 'new-key', protocolUrl: 'https://protocol.index.network' },
      {
        mcpServers: {
          'index-network': {
            url: 'https://protocol.index.network/mcp',
            transport: 'streamable-http',
            headers: { 'x-api-key': 'old-key' },
          },
        },
      },
    );
    register(fake.api);

    expect(fake.configSetCalls.length).toBe(1);
    expect((fake.configSetCalls[0].value as any).headers['x-api-key']).toBe('new-key');
  });

  test('uses default protocolUrl https://protocol.index.network when not set', () => {
    const fake = buildFakeApi(
      { agentId: 'agent-1', apiKey: 'key-1' },
      { mcpServers: {} },
    );
    register(fake.api);

    expect(fake.configSetCalls.length).toBe(1);
    expect((fake.configSetCalls[0].value as any).url).toBe('https://protocol.index.network/mcp');
  });

  test('warns user to run openclaw configure when not configured', () => {
    const fake = buildFakeApi({});
    register(fake.api);

    const warnMsg = fake.logger.warn.mock.calls[0]?.[0];
    expect(warnMsg).toContain('openclaw configure');
  });
```

- [ ] **Step 3: Run all tests**

Run: `cd packages/openclaw-plugin && bun test`
Expected: All tests PASS

- [ ] **Step 4: Commit**

```bash
git add packages/openclaw-plugin/src/tests/index.spec.ts
git commit -m "test(openclaw-plugin): add MCP auto-registration tests"
```

---

### Task 5: Update `package.json` and `openclaw.plugin.json`

**Files:**
- Modify: `packages/openclaw-plugin/package.json`
- Modify: `packages/openclaw-plugin/openclaw.plugin.json`

- [ ] **Step 1: Add `setupEntry` to `package.json`**

In `package.json`, add `"setupEntry": "./src/setup-entry.ts"` to the `openclaw` block:

```json
  "openclaw": {
    "extensions": ["./src/index.ts"],
    "setupEntry": "./src/setup-entry.ts",
    "compat": {
      "openclaw": ">=0.1.0"
    }
  }
```

- [ ] **Step 2: Update `protocolUrl` default in `openclaw.plugin.json`**

Change the `protocolUrl` property to include a default value and update its description:

```json
      "protocolUrl": {
        "type": "string",
        "format": "uri",
        "default": "https://protocol.index.network",
        "description": "Base URL of the Index Network backend."
      }
```

- [ ] **Step 3: Run all tests**

Run: `cd packages/openclaw-plugin && bun test`
Expected: All tests PASS

- [ ] **Step 4: Commit**

```bash
git add packages/openclaw-plugin/package.json packages/openclaw-plugin/openclaw.plugin.json
git commit -m "chore(openclaw-plugin): add setupEntry and update protocolUrl default"
```

---

### Task 6: Simplify frontend `SetupInstructions` for OpenClaw

**Files:**
- Modify: `frontend/src/app/agents/page.tsx:79-162`
- Modify: `frontend/src/app/agents/[id]/page.tsx:447-530`

Both files have identical `SetupInstructions` components. Update them both the same way.

- [ ] **Step 1: Update `SetupInstructions` in `frontend/src/app/agents/page.tsx`**

Replace the OpenClaw section (the `openclawInstall`, `openclawMcp`, `openclawConfigure`, `openclawDelivery` variables and their corresponding `<CodeBlock>` elements) with a single install command and a values display. The full replacement for the `SetupInstructions` function:

```tsx
function SetupInstructions({ apiKey, agentId }: { apiKey?: string; agentId?: string }) {
  const [expanded, setExpanded] = useState(false);
  const keyPlaceholder = apiKey || 'YOUR_API_KEY';
  const agentPlaceholder = agentId || 'YOUR_AGENT_ID';

  const protocolUrl = import.meta.env.VITE_PROTOCOL_URL || 'http://localhost:3001';
  const mcpUrl = `${protocolUrl}/mcp`;

  const claudeConfig = JSON.stringify(
    {
      mcpServers: {
        'index-network': {
          type: 'http',
          url: mcpUrl,
          headers: {
            'x-api-key': keyPlaceholder,
          },
        },
      },
    },
    null,
    2,
  );

  const hermesConfig = `mcp_servers:
  - name: index-network
    url: ${mcpUrl}
    headers:
      x-api-key: ${keyPlaceholder}`;

  const openclawInstall = `openclaw plugins install indexnetwork-openclaw-plugin --marketplace https://github.com/indexnetwork/openclaw-plugin`;

  return (
    <div className="border border-gray-200 rounded-sm" onClick={(e) => e.stopPropagation()}>
      <button
        type="button"
        onClick={(e) => { e.preventDefault(); e.stopPropagation(); setExpanded(!expanded); }}
        className="w-full flex items-center gap-2 px-4 py-3 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
      >
        {expanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
        Setup Instructions
      </button>
      {expanded && (
        <div className="px-4 pb-4 space-y-4 border-t border-gray-100">
          <div className="pt-3">
            <CodeBlock code={claudeConfig} label="Claude Code / OpenCode" />
          </div>
          <div>
            <CodeBlock code={hermesConfig} label="Hermes Agent" />
          </div>
          <div className="space-y-3">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">OpenClaw</p>
            <CodeBlock code={openclawInstall} label="Install plugin" />
            <div className="bg-gray-50 border border-gray-200 rounded-sm p-3 space-y-2">
              <p className="text-xs text-gray-500 font-ibm-plex-mono">
                The setup wizard will prompt for these values during installation:
              </p>
              <div className="flex items-center gap-2">
                <span className="text-xs text-gray-500 font-ibm-plex-mono w-20 shrink-0">Agent ID</span>
                <code className="text-xs bg-white border border-gray-200 rounded px-2 py-1 font-mono flex-1 select-all">{agentPlaceholder}</code>
                <CopyButton text={agentPlaceholder} />
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs text-gray-500 font-ibm-plex-mono w-20 shrink-0">API Key</span>
                <code className="text-xs bg-white border border-gray-200 rounded px-2 py-1 font-mono flex-1 select-all">{keyPlaceholder}</code>
                <CopyButton text={keyPlaceholder} />
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
```

This requires a small `CopyButton` component. Add it above `SetupInstructions`:

```tsx
function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
      className="shrink-0 p-1 text-gray-400 hover:text-gray-600 transition-colors"
      title="Copy"
    >
      {copied ? <Check className="w-3.5 h-3.5 text-green-600" /> : <Copy className="w-3.5 h-3.5" />}
    </button>
  );
}
```

Note: `Check` and `Copy` are already imported from `lucide-react` at the top of this file.

- [ ] **Step 2: Apply the same changes to `frontend/src/app/agents/[id]/page.tsx`**

The `SetupInstructions` component at lines 447-530 is identical. Apply the exact same replacement. Also add the `CopyButton` component above it.

Note: Check the imports at the top of `[id]/page.tsx` — `Check` and `Copy` may already be imported. If not, add them to the `lucide-react` import.

- [ ] **Step 3: Run frontend lint**

Run: `cd frontend && bun run lint`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add frontend/src/app/agents/page.tsx frontend/src/app/agents/\[id\]/page.tsx
git commit -m "feat(frontend): simplify OpenClaw setup instructions to single install command"
```

---

### Task 7: Bump version and run final verification

**Files:**
- Modify: `packages/openclaw-plugin/package.json` (version)
- Modify: `packages/openclaw-plugin/openclaw.plugin.json` (version)

- [ ] **Step 1: Bump version to 0.8.0 in both files**

In `packages/openclaw-plugin/package.json`, change `"version": "0.7.0"` to `"version": "0.8.0"`.

In `packages/openclaw-plugin/openclaw.plugin.json`, change `"version": "0.7.0"` to `"version": "0.8.0"`.

- [ ] **Step 2: Run all plugin tests**

Run: `cd packages/openclaw-plugin && bun test`
Expected: All tests PASS

- [ ] **Step 3: Run frontend lint**

Run: `cd frontend && bun run lint`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add packages/openclaw-plugin/package.json packages/openclaw-plugin/openclaw.plugin.json
git commit -m "chore(openclaw-plugin): bump version to 0.8.0"
```
