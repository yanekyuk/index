import crypto from 'crypto';
import { eq, and, sql } from 'drizzle-orm';

import db from '../lib/drizzle/drizzle';
import { webhooks } from '../schemas/database.schema';
import { WEBHOOK_EVENTS } from '../lib/webhook-events';
import { log } from '../lib/log';

const logger = log.service.from("WebhookService");

const IS_PRODUCTION = process.env.NODE_ENV === 'production';

/**
 * WebhookService
 *
 * Manages webhook registrations for push notifications to external consumers.
 * Handles CRUD operations, event validation, HMAC secret generation, and
 * failure tracking with automatic deactivation.
 *
 * RESPONSIBILITIES:
 * - Create/list/delete webhook registrations
 * - Validate events against the WEBHOOK_EVENTS registry
 * - Generate HMAC secrets for signature verification
 * - Track delivery success/failure with auto-deactivation at threshold
 * - Enqueue test deliveries
 */
export class WebhookService {
  /**
   * Register a new webhook for a user.
   *
   * @param userId - Owner of the webhook
   * @param url - Delivery URL (must be HTTPS in production)
   * @param events - Array of event names to subscribe to
   * @param description - Optional human-readable description
   * @returns The created webhook id and secret
   * @throws If events are invalid or URL is not HTTPS in production
   */
  async create(
    userId: string,
    url: string,
    events: string[],
    description?: string,
  ): Promise<{ id: string; secret: string }> {
    // Validate events
    const invalid = events.filter(e => !(WEBHOOK_EVENTS as readonly string[]).includes(e));
    if (invalid.length > 0) {
      throw new Error(`Invalid webhook events: ${invalid.join(', ')}`);
    }
    if (events.length === 0) {
      throw new Error('At least one event is required');
    }

    // Validate URL
    try {
      const parsed = new URL(url);
      if (IS_PRODUCTION && parsed.protocol !== 'https:') {
        throw new Error('Webhook URL must use HTTPS in production');
      }
    } catch (err) {
      if (err instanceof Error && err.message.includes('HTTPS')) throw err;
      throw new Error('Invalid webhook URL', { cause: err });
    }

    const secret = crypto.randomBytes(32).toString('hex');

    const [row] = await db.insert(webhooks).values({
      userId,
      url,
      secret,
      events,
      description: description ?? null,
    }).returning({ id: webhooks.id });

    logger.info('[WebhookService] Webhook created', { id: row.id, userId, events });

    return { id: row.id, secret };
  }

  /**
   * List all webhooks for a user with secrets masked.
   *
   * @param userId - Owner of the webhooks
   * @returns Array of webhooks with masked secrets
   */
  async list(userId: string) {
    const rows = await db.select().from(webhooks).where(eq(webhooks.userId, userId));

    return rows.map(row => ({
      ...row,
      secret: '****' + row.secret.slice(-4),
    }));
  }

  /**
   * Delete a webhook by ID, verifying ownership.
   *
   * @param userId - Owner making the request
   * @param webhookId - Webhook to delete
   * @throws If webhook not found or not owned by user
   */
  async delete(userId: string, webhookId: string): Promise<void> {
    const [row] = await db.select({ id: webhooks.id, userId: webhooks.userId })
      .from(webhooks)
      .where(eq(webhooks.id, webhookId));

    if (!row) {
      throw new Error('Not found');
    }
    if (row.userId !== userId) {
      throw new Error('Not found');
    }

    await db.delete(webhooks).where(eq(webhooks.id, webhookId));
    logger.info('[WebhookService] Webhook deleted', { webhookId, userId });
  }

  /**
   * Get a webhook by ID (for queue worker).
   *
   * @param webhookId - Webhook to retrieve
   * @returns The webhook row or null
   */
  async getById(webhookId: string) {
    const [row] = await db.select().from(webhooks).where(eq(webhooks.id, webhookId));
    return row ?? null;
  }

  /**
   * Find active webhooks for a user subscribed to a specific event.
   *
   * @param userId - User to look up webhooks for
   * @param event - Event name to match
   * @returns Array of matching active webhooks
   */
  async findByUserAndEvent(userId: string, event: string) {
    const rows = await db.select()
      .from(webhooks)
      .where(
        and(
          eq(webhooks.userId, userId),
          eq(webhooks.active, true),
          sql`${event} = ANY(${webhooks.events})`,
        )
      );

    return rows;
  }

  /**
   * Record a successful delivery: reset failure count.
   *
   * @param webhookId - Webhook that delivered successfully
   */
  async recordSuccess(webhookId: string): Promise<void> {
    await db.update(webhooks)
      .set({ failureCount: 0, updatedAt: new Date() })
      .where(eq(webhooks.id, webhookId));
  }

  /**
   * Record a delivery failure: increment count, deactivate if >= 10.
   *
   * @param webhookId - Webhook that failed delivery
   */
  async recordFailure(webhookId: string): Promise<void> {
    const [row] = await db.select({ failureCount: webhooks.failureCount })
      .from(webhooks)
      .where(eq(webhooks.id, webhookId));

    if (!row) return;

    const newCount = row.failureCount + 1;
    const updates: { failureCount: number; updatedAt: Date; active?: boolean } = {
      failureCount: newCount,
      updatedAt: new Date(),
    };

    if (newCount >= 10) {
      updates.active = false;
      logger.warn('[WebhookService] Webhook deactivated after 10 failures', { webhookId });
    }

    await db.update(webhooks).set(updates).where(eq(webhooks.id, webhookId));
  }

  /**
   * Enqueue a test delivery for a webhook.
   *
   * @param userId - Owner making the request
   * @param webhookId - Webhook to test
   * @returns Success indicator
   * @throws If webhook not found or not owned by user
   */
  async test(userId: string, webhookId: string): Promise<{ success: boolean }> {
    const [row] = await db.select().from(webhooks).where(eq(webhooks.id, webhookId));

    if (!row || row.userId !== userId) {
      throw new Error('Not found');
    }

    // Import here to avoid circular dependency at module load
    const { webhookQueue } = await import('../queues/webhook.queue');

    await webhookQueue.addJob('deliver_webhook', {
      webhookId: row.id,
      url: row.url,
      secret: row.secret,
      event: 'test',
      payload: {
        type: 'test',
        message: 'This is a test webhook delivery from Index Network',
        timestamp: new Date().toISOString(),
      },
      timestamp: new Date().toISOString(),
      deliveryId: crypto.randomUUID(),
    });

    logger.info('[WebhookService] Test delivery enqueued', { webhookId, userId });
    return { success: true };
  }
}

/** Singleton webhook service instance. */
export const webhookService = new WebhookService();
