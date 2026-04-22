import type { PluginLogger } from '../../lib/openclaw/plugin-api.js';

let timer: ReturnType<typeof setTimeout> | null = null;

export interface DigestSchedulerConfig {
  digestTime: string;
  logger: PluginLogger;
  onTrigger: () => Promise<void>;
}

/**
 * Calculates milliseconds until the next occurrence of the given digest time.
 *
 * @param digestTime - Time in "HH:MM" format (24-hour, local timezone)
 * @param now - Current date/time (defaults to new Date())
 */
export function msUntilNextDigest(digestTime: string, now: Date = new Date()): number {
  const match = /^(\d{1,2}):(\d{2})$/.exec(digestTime);
  if (!match) {
    throw new Error(`Invalid digestTime "${digestTime}" — expected HH:MM format`);
  }
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
    throw new Error(`Invalid digestTime "${digestTime}" — hours must be 0-23, minutes 0-59`);
  }

  const target = new Date(now);
  target.setHours(hours, minutes, 0, 0);

  if (target.getTime() <= now.getTime()) {
    target.setDate(target.getDate() + 1);
  }

  return target.getTime() - now.getTime();
}

export function start(config: DigestSchedulerConfig): void {
  if (timer) { clearTimeout(timer); }

  const schedule = () => {
    const delay = msUntilNextDigest(config.digestTime);
    config.logger.info(
      `Daily digest scheduled for ${config.digestTime} (in ${Math.round(delay / 60000)} minutes)`,
    );

    timer = setTimeout(async () => {
      config.logger.info('Daily digest triggered');
      try {
        await config.onTrigger();
      } catch (err) {
        config.logger.error(
          `Daily digest error: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
      schedule();
    }, delay);
    timer.unref();
  };

  schedule();
}

/** Reset module-level state. Exposed for tests only. */
export function _resetForTesting(): void {
  if (timer) { clearTimeout(timer); timer = null; }
}
