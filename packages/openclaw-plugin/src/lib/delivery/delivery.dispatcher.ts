import type { OpenClawPluginApi, SubagentRunResult } from '../openclaw/plugin-api.js';
import { readModel } from '../openclaw/plugin-api.js';
import { type DeliveryChannel, type DeliveryContentType, buildDispatcherPrompt } from './delivery.prompt.js';

export type { DeliveryChannel, DeliveryContentType };

/** Maximum time (ms) to wait for an evaluator subagent to complete before giving up. */
export const EVALUATOR_TIMEOUT_MS = 120_000;

export interface DeliveryRequest {
  contentType: DeliveryContentType;
  content: string;
  /** Stable per-message key for OpenClaw idempotency. */
  idempotencyKey: string;
}

/**
 * Returns `true` when `deliveryChannel` and `deliveryTarget` are both configured.
 */
export function isDeliveryConfigured(api: OpenClawPluginApi): boolean {
  return !!readConfigString(api, 'deliveryChannel') && !!readConfigString(api, 'deliveryTarget');
}

/**
 * Dispatches content to the user's configured OpenClaw channel.
 *
 * Reads `deliveryChannel` and `deliveryTarget` from plugin config to build the
 * session key and select the channel style. Returns `null` when routing is not
 * configured — the caller should NOT confirm delivery in that case.
 *
 * @param api - OpenClaw plugin API.
 * @param request - Content type, content, and idempotency key.
 * @returns The subagent run result, or `null` if delivery routing is missing.
 */
export async function dispatchDelivery(
  api: OpenClawPluginApi,
  request: DeliveryRequest,
): Promise<SubagentRunResult | null> {
  const channel = readConfigString(api, 'deliveryChannel') as DeliveryChannel;
  const target = readConfigString(api, 'deliveryTarget');

  if (!channel || !target) {
    api.logger.warn(
      'Index Network delivery routing not configured — skipping subagent dispatch. ' +
        'Set pluginConfig.deliveryChannel (e.g. "telegram") and pluginConfig.deliveryTarget ' +
        '(e.g. the channel-specific recipient ID like a Telegram chat ID).',
    );
    return null;
  }

  const sessionKey = `agent:main:${channel}:direct:${target}`;
  const model = await readModel(api);

  return api.runtime.subagent.run({
    sessionKey,
    idempotencyKey: request.idempotencyKey,
    message: buildDispatcherPrompt(channel, request.contentType, request.content),
    deliver: true,
    model,
  });
}

function readConfigString(api: OpenClawPluginApi, key: string): string {
  const val = api.pluginConfig[key];
  return typeof val === 'string' ? val : '';
}
