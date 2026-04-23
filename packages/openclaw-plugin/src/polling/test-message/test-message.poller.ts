import type { OpenClawPluginApi } from '../../lib/openclaw/plugin-api.js';
import { dispatchDelivery } from '../../lib/delivery/delivery.dispatcher.js';

export interface TestMessageConfig {
  baseUrl: string;
  agentId: string;
  apiKey: string;
  frontendUrl: string;
}

/**
 * Handles one test-message pickup cycle. Picks up a pending test message,
 * dispatches it via `dispatchDelivery`, then confirms delivery.
 *
 * @returns `true` if a test message was dispatched, `false` otherwise.
 */
export async function handle(
  api: OpenClawPluginApi,
  config: TestMessageConfig,
): Promise<boolean> {
  const pickupUrl = `${config.baseUrl}/api/agents/${config.agentId}/test-messages/pickup`;

  const res = await fetch(pickupUrl, {
    method: 'POST',
    headers: { 'x-api-key': config.apiKey },
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
    contentType: 'test_message',
    content: body.content,
    idempotencyKey: `index:delivery:test:${body.id}:${body.reservationToken}`,
  });

  if (dispatchResult === null) {
    return false;
  }

  const confirmUrl = `${config.baseUrl}/api/agents/${config.agentId}/test-messages/${body.id}/delivered`;
  await fetch(confirmUrl, {
    method: 'POST',
    headers: { 'x-api-key': config.apiKey, 'content-type': 'application/json' },
    body: JSON.stringify({ reservationToken: body.reservationToken }),
    signal: AbortSignal.timeout(10_000),
  }).catch((err) => {
    api.logger.warn(
      `Test-message confirm failed for ${body.id}: ${err instanceof Error ? err.message : String(err)}`,
    );
  });

  return true;
}
