import type { OpenClawPluginApi } from '../../lib/openclaw/plugin-api.js';
import { dispatchToMainAgent, detectNoReply } from '../../lib/delivery/main-agent.dispatcher.js';
import { buildMainAgentPrompt } from '../../lib/delivery/main-agent.prompt.js';
import { readMainAgentToolUse } from '../../lib/delivery/config.js';

export interface TestMessageConfig {
  baseUrl: string;
  agentId: string;
  apiKey: string;
}

/**
 * Handles one test-message pickup cycle. Test messages are delivery
 * verification — `allowSuppress: false` means the prompt does NOT include
 * a NO_REPLY clause. If the agent emits NO_REPLY anyway, the plugin logs
 * an error and lets the 60 s reservation expire so the backend retries.
 *
 * @returns `true` when a test message was rendered and confirmed,
 *          `false` when nothing was pending or delivery failed.
 */
export async function handle(
  api: OpenClawPluginApi,
  config: TestMessageConfig,
): Promise<boolean> {
  // 1. Pickup
  const pickupUrl = `${config.baseUrl}/api/agents/${config.agentId}/test-messages/pickup`;
  const pickupRes = await fetch(pickupUrl, {
    method: 'POST',
    headers: { 'x-api-key': config.apiKey },
    signal: AbortSignal.timeout(10_000),
  });

  if (pickupRes.status === 204) return false;
  if (!pickupRes.ok) {
    const text = await pickupRes.text().catch(() => '');
    api.logger.warn(`Test-message pickup failed: ${pickupRes.status} ${text}`);
    return false;
  }

  const reservation = (await pickupRes.json()) as {
    id: string;
    content: string;
    reservationToken: string;
  };

  // 2. Dispatch via main agent. allowSuppress=false: no NO_REPLY clause.
  const mainAgentToolUse = readMainAgentToolUse(api);
  const prompt = buildMainAgentPrompt({
    contentType: 'test_message',
    mainAgentToolUse,
    allowSuppress: false,
    payload: { contentType: 'test_message', content: reservation.content },
  });

  const dispatch = await dispatchToMainAgent(api, {
    prompt,
    idempotencyKey: `index:delivery:test:${reservation.id}:${reservation.reservationToken}`,
    allowSuppress: false,
  });

  if (dispatch.error === 'network_error') {
    api.logger.warn('Test-message dispatch failed; reservation will expire.');
    return false;
  }

  // 3. Detect agent ignoring no-suppress instruction.
  if (dispatch.suppressedByNoReply || detectNoReply(dispatch.deliveredText ?? '')) {
    api.logger.error(
      'Test-message: agent emitted NO_REPLY despite prompt forbidding suppression. ' +
        'Reservation will expire and backend will retry.',
    );
    return false;
  }

  // 4. Confirm.
  const confirmUrl = `${config.baseUrl}/api/agents/${config.agentId}/test-messages/${reservation.id}/delivered`;
  await fetch(confirmUrl, {
    method: 'POST',
    headers: { 'x-api-key': config.apiKey, 'content-type': 'application/json' },
    body: JSON.stringify({ reservationToken: reservation.reservationToken }),
    signal: AbortSignal.timeout(10_000),
  }).catch((err) => {
    api.logger.warn(
      `Test-message confirm failed for ${reservation.id}: ${err instanceof Error ? err.message : String(err)}`,
    );
  });

  return true;
}
