import type { AgentWithRelations } from '../adapters/agent.database.adapter';

type LegacyWebhook = {
  id: string;
  url: string;
  secret: string;
};

type LegacyWebhookLookup = {
  findByUserAndEvent(userId: string, event: string): Promise<LegacyWebhook[]>;
};

type LegacyWebhookQueue = {
  addJob(
    name: string,
    data: {
      webhookId: string;
      url: string;
      secret: string;
      event: string;
      payload: Record<string, unknown>;
      timestamp: string;
    },
    options?: { jobId?: string },
  ): Promise<unknown>;
};

type EnqueueLegacyWebhookFanoutInput = {
  userId: string;
  event: string;
  payload: Record<string, unknown>;
  getJobId?: (hook: LegacyWebhook) => string;
};

type DeliveryAgent = Pick<AgentWithRelations, 'id' | 'transports'>;

type EnqueueDeliveriesInput = {
  userId: string;
  event: string;
  payload: Record<string, unknown>;
  getJobId?: (target: { id: string }) => string;
  authorizedAgents: DeliveryAgent[];
};

/**
 * Routes legacy webhook lookup and fanout through one service during cutover.
 * Prefers agent-registry webhook transports when eligible, falls back to
 * legacy webhooks when no eligible transport exists.
 */
export class AgentDeliveryService {
  constructor(
    private readonly webhooks: LegacyWebhookLookup,
    private readonly queue?: LegacyWebhookQueue,
    private readonly now: () => Date = () => new Date(),
  ) {}

  /**
   * Reports whether a user has any active legacy webhook for an event.
   */
  async hasWebhookForEvent(userId: string, event: string): Promise<boolean> {
    const results = await this.webhooks.findByUserAndEvent(userId, event);
    return results.length > 0;
  }

  /**
   * Enqueue one legacy webhook delivery job per matching subscription.
   */
  async enqueueLegacyWebhookFanout({
    userId,
    event,
    payload,
    getJobId,
  }: EnqueueLegacyWebhookFanoutInput): Promise<void> {
    if (!this.queue) {
      throw new Error('Legacy webhook queue is not configured');
    }

    const hooks = await this.webhooks.findByUserAndEvent(userId, event);

    for (const hook of hooks) {
      await this.queue.addJob(
        'deliver_webhook',
        {
          webhookId: hook.id,
          url: hook.url,
          secret: hook.secret,
          event,
          payload,
          timestamp: this.now().toISOString(),
        },
        getJobId ? { jobId: getJobId(hook) } : undefined,
      );
    }
  }

  /**
   * Prefer agent-registry webhook transports that are both active and
   * subscribed to the target event. Falls back to legacy webhooks when
   * no eligible transport exists.
   */
  async enqueueDeliveries({
    userId,
    event,
    payload,
    getJobId,
    authorizedAgents,
  }: EnqueueDeliveriesInput): Promise<void> {
    const eligibleTransports = authorizedAgents
      .flatMap((agent) => agent.transports)
      .filter((transport) => {
        if (transport.channel !== 'webhook' || !transport.active) return false;
        const events = transport.config?.events;
        return Array.isArray(events) && events.includes(event);
      })
      .sort((a, b) => b.priority - a.priority);

    if (eligibleTransports.length > 0) {
      if (!this.queue) {
        throw new Error('Webhook queue is not configured');
      }

      for (const transport of eligibleTransports) {
        await this.queue.addJob(
          'deliver_webhook',
          {
            webhookId: transport.id,
            url: String(transport.config.url),
            secret: typeof transport.config.secret === 'string' ? transport.config.secret : '',
            event,
            payload,
            timestamp: this.now().toISOString(),
          },
          getJobId ? { jobId: getJobId(transport) } : undefined,
        );
      }

      return;
    }

    await this.enqueueLegacyWebhookFanout({ userId, event, payload, getJobId });
  }
}
