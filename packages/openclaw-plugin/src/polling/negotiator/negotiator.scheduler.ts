import type { PluginLogger } from '../../lib/openclaw/plugin-api.js';

const BASE_INTERVAL_MS = 300_000;
const MAX_BACKOFF_MULTIPLIER = 16;

let timer: ReturnType<typeof setTimeout> | null = null;
let backoffMultiplier = 1;

export interface NegotiatorSchedulerConfig {
  gatewayPort: number;
  gatewayToken: string;
  logger: PluginLogger;
}

/**
 * Starts the negotiator scheduler, which triggers the negotiator poll route
 * on a recurring interval with exponential backoff on failure.
 *
 * @param config - Scheduler configuration (gatewayPort, gatewayToken, logger).
 */
export function start(config: NegotiatorSchedulerConfig): void {
  if (timer) { clearTimeout(timer); }
  const trigger = () => {
    fetch(`http://127.0.0.1:${config.gatewayPort}/index-network/poll/negotiator`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${config.gatewayToken}` },
      signal: AbortSignal.timeout(30_000),
    }).catch((err) => {
      config.logger.error(
        `Negotiator poll trigger failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    });
  };

  const scheduleNext = () => {
    timer = setTimeout(() => { trigger(); scheduleNext(); }, BASE_INTERVAL_MS * backoffMultiplier);
    timer.unref();
  };

  scheduleNext();
  setTimeout(trigger, 5_000).unref();
}

/**
 * Increases the backoff multiplier (up to the cap) and logs the new interval.
 *
 * @param logger - Plugin logger for informational output.
 */
export function increaseBackoff(logger: PluginLogger): void {
  if (backoffMultiplier < MAX_BACKOFF_MULTIPLIER) {
    backoffMultiplier = Math.min(backoffMultiplier * 2, MAX_BACKOFF_MULTIPLIER);
    logger.info(
      `Negotiator backing off — next poll in ${(BASE_INTERVAL_MS * backoffMultiplier / 1000).toFixed(0)}s`,
    );
  }
}

/** Resets the backoff multiplier to 1 (normal interval). */
export function resetBackoff(): void {
  backoffMultiplier = 1;
}

/** Reset module-level state. Exposed for tests only. */
export function _resetForTesting(): void {
  if (timer) { clearTimeout(timer); timer = null; }
  backoffMultiplier = 1;
}
