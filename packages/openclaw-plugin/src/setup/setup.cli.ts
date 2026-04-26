/**
 * Index Network — OpenClaw CLI setup command.
 *
 * Registered via `api.registerCli()` and invoked as:
 *
 *   openclaw index-network setup
 *
 * Collects url, apiKey, and mainAgentToolUse, resolves the caller's
 * agentId from the API key via GET /api/agents/me, then writes plugin
 * config and registers the MCP server.
 *
 * Wizard steps (in order):
 *   1. Index Network URL
 *   2. API key
 *   3. Daily digest (enabled/disabled)
 *   4. Digest time (if enabled)
 *   5. Max opportunities per digest (if enabled)
 *   6. Main agent tool use during Index Network renders
 *   7. MCP server registration
 *
 * MIRROR: The Index Network agents page renders a copyable preview of
 * this same wizard for users who run setup outside an LLM. When you
 * change the prompts here (add a step, rename a label, remove a field),
 * also update `WizardPromptGrid` and `SetupInstructions` in
 * `frontend/src/app/agents/[id]/page.tsx` so the two stay in sync.
 */

import { randomBytes } from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as readline from 'node:readline/promises';

import { deriveUrls } from '../lib/utils/url.js';
import { defaultFetchAgentId } from './fetch-agent-id.js';

const PLUGIN_ID = 'indexnetwork-openclaw-plugin';
const CONFIG_PATH = path.join(os.homedir(), '.openclaw', 'openclaw.json');
const DEFAULT_URL = 'https://index.network';

/**
 * Abstraction over user I/O and config writes. The CLI command injects
 * a real readline-backed implementation; tests inject fakes.
 */
export interface SetupContext {
  /** Full OpenClaw config snapshot. */
  cfg: Record<string, unknown>;
  /** Prompt the user for free-text input. */
  prompt(label: string, opts?: { default?: string; secret?: boolean }): Promise<string>;
  /** Prompt the user to select from a list. Returns the selected value. */
  select(label: string, choices: Array<{ label: string; value: string }>): Promise<string>;
  /** Write a value into the OpenClaw config file. */
  configSet(path: string, value: unknown): Promise<void>;
  /** Resolve the caller's agentId from the API key. Tests inject a fake. */
  fetchAgentId(protocolUrl: string, apiKey: string): Promise<string>;
}

/** Read a single dot-path value from the OpenClaw config snapshot. */
function getExistingConfig(cfg: Record<string, unknown>, dotPath: string): string | undefined {
  return getStringAt(cfg, dotPath);
}

/** Read a string at a dot-path in the cfg snapshot, or return undefined. */
function getStringAt(cfg: Record<string, unknown>, dotPath: string): string | undefined {
  const value = getRawAt(cfg, dotPath);
  return typeof value === 'string' ? value : undefined;
}

/** Read a boolean at a dot-path in the cfg snapshot, or return undefined. */
function getBooleanAt(cfg: Record<string, unknown>, dotPath: string): boolean | undefined {
  const value = getRawAt(cfg, dotPath);
  return typeof value === 'boolean' ? value : undefined;
}

/** Read a string array at a dot-path in the cfg snapshot, or return undefined. */
function getStringArrayAt(
  cfg: Record<string, unknown>,
  dotPath: string,
): string[] | undefined {
  const value = getRawAt(cfg, dotPath);
  if (!Array.isArray(value)) return undefined;
  const filtered = value.filter((v): v is string => typeof v === 'string');
  return filtered.length === value.length ? filtered : undefined;
}

function getRawAt(cfg: Record<string, unknown>, dotPath: string): unknown {
  const parts = dotPath.split('.');
  let obj: unknown = cfg;
  for (const key of parts) {
    if (typeof obj !== 'object' || obj === null) return undefined;
    obj = (obj as Record<string, unknown>)[key];
  }
  return obj;
}

/**
 * Core setup logic — testable via injected `SetupContext`.
 *
 * Only prompts for values that are not already set; re-running the wizard
 * fills in gaps without clobbering existing config.
 */
export async function runSetup(ctx: SetupContext): Promise<void> {
  const configPrefix = `plugins.entries.${PLUGIN_ID}.config`;

  const existing = (key: string) => getExistingConfig(ctx.cfg, `${configPrefix}.${key}`);

  // --- URL (with legacy protocolUrl migration) ---
  const legacyProtocolUrl = existing('protocolUrl');
  let defaultUrl = existing('url') || DEFAULT_URL;
  if (!existing('url') && legacyProtocolUrl) {
    defaultUrl = deriveUrls(legacyProtocolUrl).frontendUrl;
  }
  const url = await ctx.prompt('Index Network URL', { default: defaultUrl });
  const { protocolUrl } = deriveUrls(url);

  // --- API Key ---
  const apiKey = existing('apiKey')
    ? await ctx.prompt('API key (leave blank to keep existing)', { secret: true })
    : await ctx.prompt('API key', { secret: true });
  const resolvedApiKey = apiKey || existing('apiKey') || '';
  if (!resolvedApiKey) {
    throw new Error('API key is required. Generate one on the Index Network Agents page.');
  }

  // --- Resolve agentId from API key ---
  const agentId = await ctx.fetchAgentId(protocolUrl, resolvedApiKey);

  // --- Write core config ---
  await ctx.configSet(`${configPrefix}.url`, url);
  await ctx.configSet(`${configPrefix}.agentId`, agentId);
  await ctx.configSet(`${configPrefix}.apiKey`, resolvedApiKey);

  if (legacyProtocolUrl) {
    await ctx.configSet(`${configPrefix}.protocolUrl`, undefined);
  }

  // --- Daily digest config ---
  const digestEnabled = await ctx.select('Daily digest', [
    { label: 'Enabled (default)', value: 'true' },
    { label: 'Disabled', value: 'false' },
  ]);
  await ctx.configSet(`${configPrefix}.digestEnabled`, digestEnabled);

  if (digestEnabled !== 'false') {
    const digestTime = await ctx.prompt('Digest time (HH:MM, 24-hour local time)', {
      default: existing('digestTime') || '08:00',
    });
    await ctx.configSet(`${configPrefix}.digestTime`, digestTime);

    const digestMaxCount = await ctx.prompt('Max opportunities per digest', {
      default: existing('digestMaxCount') || '20',
    });
    await ctx.configSet(`${configPrefix}.digestMaxCount`, digestMaxCount);
  }

  // --- Main agent tool use ---
  const mainAgentToolUse = await ctx.select('Main agent tool use during Index Network renders', [
    { label: 'Disabled — agent renders from provided content only (default)', value: 'disabled' },
    { label: 'Enabled — agent may call MCP tools to enrich', value: 'enabled' },
  ]);
  await ctx.configSet(`${configPrefix}.mainAgentToolUse`, mainAgentToolUse || 'disabled');

  // --- Bootstrap gateway hooks (required for /hooks/agent dispatch) ---
  // The plugin dispatches notifications via POST /hooks/agent, which requires
  // hooks.enabled=true and a non-empty hooks.token distinct from the gateway
  // auth token. Existing hooks.token values are preserved (a user may already
  // be using the hooks subsystem for other integrations); only fill in gaps.
  const existingHooksToken = getStringAt(ctx.cfg, 'hooks.token');
  const existingHooksEnabled = getBooleanAt(ctx.cfg, 'hooks.enabled');
  const existingHooksPath = getStringAt(ctx.cfg, 'hooks.path');
  const gatewayAuthToken = getStringAt(ctx.cfg, 'gateway.auth.token');

  const hooksToken =
    existingHooksToken && existingHooksToken !== gatewayAuthToken
      ? existingHooksToken
      : randomBytes(32).toString('hex');

  if (existingHooksToken && existingHooksToken === gatewayAuthToken) {
    throw new Error(
      'hooks.token must be distinct from gateway.auth.token. ' +
        'Run `openclaw config unset hooks.token` and re-run setup to regenerate.',
    );
  }

  if (hooksToken !== existingHooksToken) {
    await ctx.configSet('hooks.token', hooksToken);
  }
  if (existingHooksEnabled !== true) {
    await ctx.configSet('hooks.enabled', true);
  }
  if (!existingHooksPath) {
    await ctx.configSet('hooks.path', '/hooks');
  }

  // The dispatcher passes `sessionKey` so /hooks/agent runs land in the user's
  // existing chat-bound session (instead of a fresh isolated session that has
  // no channel binding). Both knobs are required: gateway rejects per-request
  // sessionKey unless allowRequestSessionKey is true and the prefix is allowed.
  const existingAllowRequestSessionKey = getBooleanAt(
    ctx.cfg,
    'hooks.allowRequestSessionKey',
  );
  if (existingAllowRequestSessionKey !== true) {
    await ctx.configSet('hooks.allowRequestSessionKey', true);
  }

  const REQUIRED_SESSION_KEY_PREFIX = 'agent:main:';
  const existingPrefixes = getStringArrayAt(ctx.cfg, 'hooks.allowedSessionKeyPrefixes') ?? [];
  if (!existingPrefixes.includes(REQUIRED_SESSION_KEY_PREFIX)) {
    await ctx.configSet('hooks.allowedSessionKeyPrefixes', [
      ...existingPrefixes,
      REQUIRED_SESSION_KEY_PREFIX,
    ]);
  }

  // --- Register MCP server ---
  const normalizedProtocolUrl = protocolUrl.replace(/\/+$/, '');
  const mcpDef = {
    url: `${normalizedProtocolUrl}/mcp`,
    transport: 'streamable-http',
    headers: { 'x-api-key': resolvedApiKey },
  };
  await ctx.configSet('mcp.servers.index-network', mcpDef);
}

/**
 * Registers the `openclaw index-network setup` CLI command.
 *
 * @param program - Commander program instance provided by OpenClaw's `registerCli`.
 * @param api     - Plugin API for reading config and calling `configSet`.
 */
/**
 * Read the OpenClaw config file, or return an empty object if missing.
 */
function readOpenClawConfig(): Record<string, unknown> {
  try {
    return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
  } catch {
    return {};
  }
}

/**
 * Set a dot-path key in the OpenClaw config and write it back to disk.
 * E.g. `setConfigValue(cfg, "plugins.entries.foo.config.bar", 123)`.
 */
function setConfigValue(cfg: Record<string, unknown>, dotPath: string, value: unknown): void {
  const parts = dotPath.split('.');
  let obj: Record<string, unknown> = cfg;
  for (let i = 0; i < parts.length - 1; i++) {
    const key = parts[i];
    if (typeof obj[key] !== 'object' || obj[key] === null) {
      obj[key] = {};
    }
    obj = obj[key] as Record<string, unknown>;
  }
  obj[parts[parts.length - 1]] = value;
}

export function registerSetupCli(
  program: {
    command(name: string): { description(d: string): { action(fn: () => Promise<void>): void } };
    commands?: Array<{ name(): string }>;
  },
): void {
  // Guard against duplicate registration — OpenClaw may invoke the callback multiple times.
  if (program.commands?.some((c) => c.name() === 'setup')) return;

  program
    .command('setup')
    .description('Interactive setup wizard for Index Network')
    .action(async () => {
      const cfg = readOpenClawConfig();
      const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

      const ctx: SetupContext = {
        cfg,
        prompt: async (label, opts) => {
          const defaultSuffix = opts?.default ? ` [${opts.default}]` : '';
          const answer = await rl.question(`${label}${defaultSuffix}: `);
          return answer.trim() || opts?.default || '';
        },
        select: async (label, choices) => {
          console.log(`\n${label}:`);
          choices.forEach((c, i) => console.log(`  ${i + 1}. ${c.label}`));
          const answer = await rl.question('Selection: ');
          const idx = parseInt(answer.trim(), 10) - 1;
          return choices[idx]?.value ?? '';
        },
        configSet: async (dotPath, value) => {
          setConfigValue(cfg, dotPath, value);
        },
        fetchAgentId: defaultFetchAgentId,
      };

      try {
        await runSetup(ctx);
        // Write the entire config back in one atomic operation
        fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2));
        console.log('\n✓ Config written to ~/.openclaw/openclaw.json');
        console.log('Restart the gateway to apply changes: openclaw gateway restart');
      } catch (err) {
        console.error(err instanceof Error ? err.message : String(err));
        process.exitCode = 1;
      } finally {
        rl.close();
      }
    });
}
