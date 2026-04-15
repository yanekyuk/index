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
  const normalizedUrl = protocolUrl.replace(/\/+$/, '');
  const mcpDef = {
    url: `${normalizedUrl}/mcp`,
    transport: 'streamable-http',
    headers: { 'x-api-key': apiKey },
  };
  await ctx.configSet(`mcp.servers.index-network`, mcpDef);
}
