import type { OpenClawPluginApi, SubagentRunResult } from './plugin-api.js';
import { deliveryPrompt } from './prompts/delivery.prompt.js';

export interface DeliveryRequest {
  rendered: { headline: string; body: string };
  sessionKey: string;
  idempotencyKey: string;
}

export async function dispatchDelivery(
  api: OpenClawPluginApi,
  request: DeliveryRequest,
): Promise<SubagentRunResult> {
  return api.runtime.subagent.run({
    sessionKey: request.sessionKey,
    idempotencyKey: request.idempotencyKey,
    message: deliveryPrompt(request.rendered),
    deliver: true,
  });
}
