/**
 * Index Network — OpenClaw plugin entry point.
 *
 * Polls the Index Network backend for pending negotiation turns via:
 *
 *   POST /agents/:agentId/negotiations/pickup
 *
 * Because `api.runtime.subagent.run()` is request-scoped in OpenClaw (only
 * available inside an HTTP route handler), the plugin registers a route at
 * `POST /index-network/poll` and the background interval triggers it via a
 * local fetch. This gives each poll cycle a proper request scope.
 *
 * When a turn is found, dispatches a silent subagent that calls
 * `get_negotiation` + `respond_to_negotiation` on the parent's Index Network
 * MCP pool to decide and submit the response.
 *
 * Uses `definePluginEntry` from the OpenClaw plugin SDK so that CLI commands
 * (e.g. `openclaw index-network setup`) are properly registered.
 */

import type { OpenClawPluginApi } from './lib/openclaw/plugin-api.js';
import { dispatchDelivery } from './lib/delivery/delivery.dispatcher.js';
import * as negotiatorPoller from './polling/negotiator/negotiator.poller.js';
import * as negotiatorScheduler from './polling/negotiator/negotiator.scheduler.js';
import * as dailyDigestPoller from './polling/daily-digest/daily-digest.poller.js';
import * as dailyDigestScheduler from './polling/daily-digest/daily-digest.scheduler.js';
import * as ambientDiscoveryPoller from './polling/ambient-discovery/ambient-discovery.poller.js';
import * as ambientDiscoveryScheduler from './polling/ambient-discovery/ambient-discovery.scheduler.js';
import { registerSetupCli } from './setup/setup.cli.js';

/** Base polling interval: 5 minutes. */
const POLL_INTERVAL_MS = 300_000;

/** Max backoff multiplier (caps at ~8 minutes). */
const MAX_BACKOFF_MULTIPLIER = 16;

const POLL_PATH = '/index-network/poll';

/** Prevents double-registration when OpenClaw calls register() more than once. */
let registered = false;

/** Current backoff multiplier — increases on consecutive failures, resets on success. */
let backoffMultiplier = 1;

/** Handle returned by setInterval, stored so tests can inspect or clear it. */
let pollTimer: ReturnType<typeof setInterval> | null = null;

/**
 * Registers the `openclaw index-network setup` CLI command if the host
 * supports `registerCli`. Safe to call even when the plugin is unconfigured.
 */
function registerSetupCommand(api: OpenClawPluginApi): void {
  if (!api.registerCli) {
    api.logger.debug('registerCli not available — skipping CLI setup command.');
    return;
  }

  api.registerCli(
    ({ program }) => {
      const cmd = (program as { command(n: string): { description(d: string): unknown } })
        .command('index-network')
        .description('Manage Index Network plugin configuration');
      registerSetupCli(cmd as Parameters<typeof registerSetupCli>[0]);
    },
    { commands: ['index-network'] },
  );
}

/**
 * Ensures the `index-network` MCP server definition in OpenClaw config
 * matches the current plugin config. Creates or updates as needed.
 */
function ensureMcpServer(api: OpenClawPluginApi, baseUrl: string, apiKey: string): void {
  if (!api.configSet) {
    api.logger.debug('configSet not available — skipping MCP auto-registration.');
    return;
  }
  // Never overwrite MCP config with an empty key — an empty apiKey means the
  // plugin is not yet configured, not that the key should be blanked out.
  if (!apiKey) {
    api.logger.warn('API key not configured — skipping MCP auto-registration. Run `openclaw index-network setup`.');
    return;
  }

  const normalizedUrl = baseUrl.replace(/\/+$/, '');
  const expected = {
    url: `${normalizedUrl}/mcp`,
    transport: 'streamable-http',
    headers: { 'x-api-key': apiKey },
  };

  const current = api.config?.mcp?.servers?.['index-network'];
  const needsUpdate =
    !current ||
    current.url !== expected.url ||
    current.transport !== expected.transport ||
    current.headers?.['x-api-key'] !== apiKey;

  if (needsUpdate) {
    api.configSet('mcp.servers.index-network', expected).then(
      () => api.logger.info('Index Network MCP server registered/updated.'),
      (err) => api.logger.warn(
        `Failed to auto-register MCP server: ${err instanceof Error ? err.message : String(err)}`,
      ),
    );
  }
}

/**
 * Core plugin registration logic. Called by both `definePluginEntry` (production)
 * and directly in tests.
 */
export function register(api: OpenClawPluginApi): void {
  if (registered) {
    api.logger.debug('Index Network plugin already registered, skipping duplicate call.');
    return;
  }
  registered = true;

  // Register `openclaw index-network setup` CLI command unconditionally
  registerSetupCommand(api);

  const agentId = readConfig(api, 'agentId');
  const apiKey = readConfig(api, 'apiKey');

  if (!agentId || !apiKey) {
    api.logger.warn(
      'Index Network plugin not configured. Run `openclaw index-network setup` to complete setup.',
    );
    return;
  }

  const baseUrl = readConfig(api, 'protocolUrl') || 'https://protocol.index.network';
  ensureMcpServer(api, baseUrl, apiKey);
  const gatewayPort = api.config?.gateway?.port ?? 18789;
  const gatewayToken = api.config?.gateway?.auth?.token ?? '';

  // Route MUST use auth: 'gateway' (not 'plugin') — subagent.run() requires
  // operator.write scope, which only gateway-authed routes receive.
  api.registerHttpRoute({
    path: POLL_PATH,
    auth: 'gateway',
    match: 'exact',
    handler: async (req, res) => {
      try {
        await poll(api, baseUrl, agentId, apiKey);
        res.statusCode = 200;
        res.end('ok');
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        api.logger.error(`Poll handler error: ${msg}`);
        res.statusCode = 500;
        res.end(msg);
      }
      return true;
    },
  });

  // Register negotiator route
  const negotiationMode = readConfig(api, 'negotiationMode') || 'enabled';
  if (negotiationMode !== 'disabled') {
    api.registerHttpRoute({
      path: '/index-network/poll/negotiator',
      auth: 'gateway',
      match: 'exact',
      handler: async (_req, res) => {
        try {
          const result = await negotiatorPoller.handle(api, { baseUrl, agentId, apiKey });
          if (result === 'network_error') {
            negotiatorScheduler.increaseBackoff(api.logger);
          } else {
            negotiatorScheduler.resetBackoff();
          }
          res.statusCode = 200;
          res.end('ok');
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          api.logger.error(`Negotiator poll handler error: ${msg}`);
          negotiatorScheduler.increaseBackoff(api.logger);
          res.statusCode = 500;
          res.end(msg);
        }
        return true;
      },
    });

    // Start negotiator scheduler
    negotiatorScheduler.start({ gatewayPort, gatewayToken, logger: api.logger });
  }

  // Register ambient discovery route
  api.registerHttpRoute({
    path: '/index-network/poll/ambient-discovery',
    auth: 'gateway',
    match: 'exact',
    handler: async (_req, res) => {
      try {
        const result = await ambientDiscoveryPoller.handle(api, { baseUrl, agentId, apiKey });
        if (!result) {
          ambientDiscoveryScheduler.increaseBackoff(api.logger);
        } else {
          ambientDiscoveryScheduler.resetBackoff();
        }
        res.statusCode = 200;
        res.end('ok');
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        api.logger.error(`Ambient discovery poll handler error: ${msg}`);
        ambientDiscoveryScheduler.increaseBackoff(api.logger);
        res.statusCode = 500;
        res.end(msg);
      }
      return true;
    },
  });

  ambientDiscoveryScheduler.start({ gatewayPort, gatewayToken, logger: api.logger });

  api.logger.info('Index Network polling started', {
    plugin: api.id,
    agentId,
    intervalMs: POLL_INTERVAL_MS,
  });

  // Trigger polling via self-POST to the registered route
  const triggerPoll = () => {
    const url = `http://127.0.0.1:${gatewayPort}${POLL_PATH}`;
    fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${gatewayToken}`,
      },
      signal: AbortSignal.timeout(30_000),
    }).catch((err) => {
      api.logger.error(`Poll trigger failed: ${err instanceof Error ? err.message : String(err)}`);
    });
  };

  // Schedule polling with dynamic backoff
  const scheduleNext = () => {
    const delay = POLL_INTERVAL_MS * backoffMultiplier;
    pollTimer = setTimeout(() => {
      triggerPoll();
      scheduleNext();
    }, delay);
    pollTimer.unref();
  };

  scheduleNext();

  // Schedule daily digest
  const digestEnabled = readConfig(api, 'digestEnabled') !== 'false';
  if (digestEnabled) {
    const digestTime = readConfig(api, 'digestTime') || '08:00';
    const _parsedMax = parseInt(readConfig(api, 'digestMaxCount') || '10', 10);
    const digestMaxCount = Math.max(1, Number.isNaN(_parsedMax) ? 10 : _parsedMax);

    dailyDigestScheduler.start({
      digestTime,
      logger: api.logger,
      onTrigger: () => dailyDigestPoller.handle(api, { baseUrl, agentId, apiKey, maxCount: digestMaxCount }),
    });
  }

  // First poll after a short delay to let the gateway fully start.
  // This initial poll also runs a reachability check on the backend.
  setTimeout(() => {
    checkBackendReachability(api, baseUrl);
    triggerPoll();
  }, 5_000).unref();
}

// --- Plugin entry ---
// Plain object export matching OpenClaw's expected plugin shape.
// Works with or without definePluginEntry — OpenClaw recognizes { id, register }.
export default {
  id: 'indexnetwork-openclaw-plugin',
  name: 'Index Network',
  description: 'Find the right people and let them find you.',
  register,
};

async function poll(
  api: OpenClawPluginApi,
  baseUrl: string,
  agentId: string,
  apiKey: string,
): Promise<void> {
  await handleTestMessagePickup(api, baseUrl, agentId, apiKey);
}

/**
 * Handles one test-message pickup cycle. Picks up a pending test message,
 * dispatches it via `dispatchDelivery`, then confirms delivery.
 *
 * @returns `true` if a test message was dispatched, `false` otherwise.
 * @internal
 */
export async function handleTestMessagePickup(
  api: OpenClawPluginApi,
  baseUrl: string,
  agentId: string,
  apiKey: string,
): Promise<boolean> {
  const pickupUrl = `${baseUrl}/api/agents/${agentId}/test-messages/pickup`;

  const res = await fetch(pickupUrl, {
    method: 'POST',
    headers: { 'x-api-key': apiKey },
    signal: AbortSignal.timeout(10_000),
  });

  if (res.status === 204) {
    return false;
  }

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    api.logger.warn(`Test-message pickup failed: ${res.status} ${text}`);
    return false;
  }

  const body = (await res.json()) as {
    id: string;
    content: string;
    reservationToken: string;
  };

  const dispatchResult = await dispatchDelivery(api, {
    rendered: { headline: 'Test message', body: body.content },
    idempotencyKey: `index:delivery:test:${body.id}:${body.reservationToken}`,
  });

  // If delivery routing wasn't configured, don't confirm — let reservation expire so we can retry once configured.
  if (dispatchResult === null) {
    return false;
  }

  // Confirm delivery — failures are warnings only, dispatch already happened
  const confirmUrl = `${baseUrl}/api/agents/${agentId}/test-messages/${body.id}/delivered`;
  await fetch(confirmUrl, {
    method: 'POST',
    headers: { 'x-api-key': apiKey, 'content-type': 'application/json' },
    body: JSON.stringify({ reservationToken: body.reservationToken }),
    signal: AbortSignal.timeout(10_000),
  }).catch((err) => {
    api.logger.warn(
      `Test-message confirm failed for ${body.id}: ${err instanceof Error ? err.message : String(err)}`,
    );
  });

  return true;
}

function increaseBackoff(api: OpenClawPluginApi): void {
  if (backoffMultiplier < MAX_BACKOFF_MULTIPLIER) {
    backoffMultiplier = Math.min(backoffMultiplier * 2, MAX_BACKOFF_MULTIPLIER);
    api.logger.info(
      `Backing off — next poll in ${(POLL_INTERVAL_MS * backoffMultiplier / 1000).toFixed(0)}s`,
    );
  }
}

/**
 * One-time startup check: verifies the backend is reachable. Logs an
 * actionable warning if it isn't, so users catch misconfigurations early.
 */
function checkBackendReachability(api: OpenClawPluginApi, baseUrl: string): void {
  fetch(`${baseUrl}/api/health`, {
    method: 'GET',
    signal: AbortSignal.timeout(5_000),
  }).catch(() => {
    api.logger.warn(
      `Cannot reach Index Network backend at ${baseUrl}. ` +
      `Check that the backend is running and protocolUrl is correct in plugin config.`,
    );
  });
}

function readConfig(api: OpenClawPluginApi, key: string): string {
  const val = api.pluginConfig[key];
  return typeof val === 'string' ? val : '';
}

/**
 * Reset module-level state. Exposed for tests only — not part of public API.
 * @internal
 */
export function _resetForTesting(): void {
  registered = false;
  backoffMultiplier = 1;        // still used by index.ts poll loop until Task 6
  if (pollTimer) {
    clearTimeout(pollTimer);
    pollTimer = null;
  }
  negotiatorPoller._resetForTesting();
  negotiatorScheduler._resetForTesting();
  dailyDigestScheduler._resetForTesting();
  ambientDiscoveryPoller._resetForTesting();
  ambientDiscoveryScheduler._resetForTesting();
}
