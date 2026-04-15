/**
 * Index Network — OpenClaw CLI setup command.
 *
 * Registered via `api.registerCli()` and invoked as:
 *
 *   openclaw index-network setup
 *
 * Collects protocolUrl, agentId, apiKey, and optional delivery routing,
 * then writes plugin config and registers the MCP server.
 */

import * as readline from 'node:readline/promises';

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
}

/**
 * Core setup logic — testable via injected `SetupContext`.
 */
export async function runSetup(ctx: SetupContext): Promise<void> {
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
  const normalizedUrl = protocolUrl.replace(/\/+$/, '');
  const mcpDef = {
    url: `${normalizedUrl}/mcp`,
    transport: 'streamable-http',
    headers: { 'x-api-key': apiKey },
  };
  await ctx.configSet('mcp.servers.index-network', mcpDef);
}

/**
 * Registers the `openclaw index-network setup` CLI command.
 *
 * @param program - Commander program instance provided by OpenClaw's `registerCli`.
 * @param api     - Plugin API for reading config and calling `configSet`.
 */
export function registerSetupCli(
  program: { command(name: string): { description(d: string): { action(fn: () => Promise<void>): void } } },
  api: { config?: Record<string, unknown>; configSet?(path: string, value: unknown): Promise<void> },
): void {
  program
    .command('setup')
    .description('Interactive setup wizard for Index Network')
    .action(async () => {
      if (!api.configSet) {
        console.error('configSet not available — cannot write config.');
        process.exitCode = 1;
        return;
      }

      const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

      const ctx: SetupContext = {
        cfg: api.config || {},
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
        configSet: api.configSet.bind(api),
      };

      try {
        await runSetup(ctx);
        console.log('\nSetup complete. Restart the gateway to apply changes.');
      } catch (err) {
        console.error(err instanceof Error ? err.message : String(err));
        process.exitCode = 1;
      } finally {
        rl.close();
      }
    });
}
