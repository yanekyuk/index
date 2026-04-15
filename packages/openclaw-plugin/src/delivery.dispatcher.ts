import type { OpenClawPluginApi, SubagentRunResult } from './plugin-api.js';
import { deliveryPrompt } from './prompts/delivery.prompt.js';

export interface DeliveryRequest {
  rendered: { headline: string; body: string };
  /** Stable per-message key for OpenClaw idempotency. */
  idempotencyKey: string;
}

/**
 * Dispatches a rendered card to the user's configured OpenClaw channel.
 *
 * Reads `pluginConfig.deliveryChannel` and `pluginConfig.deliveryTarget`
 * to build a session key in OpenClaw's routing format
 * (`agent:main:<channel>:direct:<target>`), so the subagent's `deliver: true`
 * announce reaches the user via that channel.
 *
 * Returns `null` when delivery routing is not configured — the caller should
 * NOT proceed to confirm delivery in that case.
 *
 * @param api - OpenClaw plugin API.
 * @param request - Rendered card and idempotency key.
 * @returns The subagent run result, or `null` if delivery routing is missing.
 */
export async function dispatchDelivery(
  api: OpenClawPluginApi,
  request: DeliveryRequest,
): Promise<SubagentRunResult | null> {
  const channel = readConfigString(api, 'deliveryChannel');
  const target = readConfigString(api, 'deliveryTarget');

  if (!channel || !target) {
    api.logger.warn(
      'Index Network delivery routing not configured — skipping subagent dispatch. ' +
        'Set pluginConfig.deliveryChannel (e.g. "telegram") and pluginConfig.deliveryTarget ' +
        '(e.g. the channel-specific recipient ID like a Telegram chat ID).',
    );
    return null;
  }

  return api.runtime.subagent.run({
    sessionKey: `agent:main:${channel}:direct:${target}`,
    idempotencyKey: request.idempotencyKey,
    message: deliveryPrompt(request.rendered),
    deliver: true,
  });
}

function readConfigString(api: OpenClawPluginApi, key: string): string {
  const val = api.pluginConfig[key];
  return typeof val === 'string' ? val : '';
}
