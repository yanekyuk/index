import crypto from 'crypto';
import { Job } from 'bullmq';
import { log } from '../lib/log';
import { QueueFactory } from '../lib/bullmq/bullmq';
import { webhookService } from '../services/webhook.service';

/** BullMQ queue name for webhook delivery jobs. */
export const QUEUE_NAME = 'webhook-delivery';

/** Payload for a single webhook delivery job. */
export interface WebhookJobData {
  webhookId: string;
  url: string;
  secret: string;
  event: string;
  payload: Record<string, unknown>;
  timestamp: string;
  /** Stable delivery ID, reused across retries. Emitted as X-Request-ID for consumer dedupe. */
  deliveryId: string;
}

/**
 * Build the outbound header set for a webhook POST. Pure function, testable in isolation.
 *
 * @param opts.signatureHex - Raw HMAC-SHA256 hex digest (no prefix).
 * @param opts.event - Event name (e.g. `opportunity.created`).
 * @param opts.deliveryId - Stable delivery ID, reused across retries.
 */
export function buildWebhookRequestHeaders(opts: {
  signatureHex: string;
  event: string;
  deliveryId: string;
}): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    'X-Index-Signature': `sha256=${opts.signatureHex}`,
    'X-Index-Event': opts.event,
    'X-Request-ID': opts.deliveryId,
  };
}

/**
 * WebhookQueue: BullMQ queue + worker for delivering webhook HTTP requests.
 *
 * Worker logic:
 * 1. Serialize payload as JSON
 * 2. Compute HMAC-SHA256 signature using the webhook secret
 * 3. POST to the URL with signature header
 * 4. On 2xx: record success (reset failure count)
 * 5. On non-2xx or timeout: throw so BullMQ retries with exponential backoff
 *
 * After all retries exhausted, recordFailure increments the count and
 * deactivates the webhook at >= 10 consecutive failures.
 *
 * @remarks
 * Workers are started only by the protocol server via {@link WebhookQueue.startWorker}.
 */
export class WebhookQueue {
  static readonly QUEUE_NAME = QUEUE_NAME;

  readonly queue = QueueFactory.createQueue<WebhookJobData>(QUEUE_NAME);

  private readonly logger = log.job.from('WebhookJob');
  private readonly queueLogger = log.queue.from('WebhookQueue');
  private worker: ReturnType<typeof QueueFactory.createWorker<WebhookJobData>> | null = null;
  private queueEvents: ReturnType<typeof QueueFactory.createQueueEvents> | null = null;

  /**
   * Enqueue a webhook delivery job.
   *
   * @param name - Job name (e.g. 'deliver_webhook')
   * @param data - Webhook delivery payload
   * @param options - Optional BullMQ job options
   * @returns The BullMQ job
   */
  async addJob(
    name: string,
    data: WebhookJobData,
    options?: { jobId?: string; priority?: number },
  ) {
    return this.queue.add(name, data, {
      jobId: options?.jobId,
      priority: options?.priority,
      attempts: 3,
      backoff: { type: 'exponential', delay: 2000 },
      removeOnComplete: { age: 3600 }, // 1 hour
      removeOnFail: { age: 7 * 24 * 3600 },
    });
  }

  /**
   * Process a webhook delivery job. Exported for testing.
   *
   * @param name - Job name
   * @param data - Webhook delivery payload
   */
  async processJob(name: string, data: WebhookJobData): Promise<void> {
    switch (name) {
      case 'deliver_webhook':
        await this.handleDelivery(data);
        break;
      default:
        this.queueLogger.warn(`[WebhookProcessor] Unknown job name: ${name}`);
    }
  }

  /**
   * Start the BullMQ worker and queue events listener. Idempotent.
   */
  startWorker(): void {
    if (this.worker) return;

    const processor = async (job: Job<WebhookJobData>) => {
      this.queueLogger.info(`[WebhookProcessor] Processing job ${job.id} (${job.name})`);
      await this.processJob(job.name, job.data);
    };

    this.worker = QueueFactory.createWorker<WebhookJobData>(QUEUE_NAME, processor);

    // Listen for final failure (all retries exhausted) to record failure
    this.queueEvents = QueueFactory.createQueueEvents(QUEUE_NAME);
    this.queueEvents.on('failed', async ({ jobId }) => {
      try {
        const job = await Job.fromId<WebhookJobData>(this.queue, jobId);
        if (job && job.attemptsMade >= (job.opts.attempts ?? 3)) {
          await webhookService.recordFailure(job.data.webhookId);
          this.logger.warn('[WebhookJob] All retries exhausted, recorded failure', {
            webhookId: job.data.webhookId,
            jobId,
          });
        }
      } catch (err) {
        this.logger.error('[WebhookJob] Failed to record webhook failure', {
          jobId,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    });
  }

  /**
   * Gracefully close worker and queue.
   */
  async close(): Promise<void> {
    if (this.queueEvents) {
      await this.queueEvents.close();
      this.queueEvents = null;
    }
    if (this.worker) {
      await this.worker.close();
      this.worker = null;
    }
    await this.queue.close();
  }

  /**
   * Deliver a webhook: POST the payload with HMAC-SHA256 signature.
   */
  private async handleDelivery(data: WebhookJobData): Promise<void> {
    const { webhookId, url, secret, event, payload, timestamp, deliveryId } = data;

    const body = JSON.stringify({ event, payload, timestamp });
    const signatureHex = crypto.createHmac('sha256', secret).update(body).digest('hex');

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: buildWebhookRequestHeaders({ signatureHex, event, deliveryId }),
        body,
        signal: controller.signal,
      });

      if (response.ok) {
        await webhookService.recordSuccess(webhookId);
        this.logger.info('[WebhookJob] Delivered successfully', { webhookId, event, status: response.status });
      } else {
        const text = await response.text().catch(() => '');
        throw new Error(`Webhook delivery failed: HTTP ${response.status} - ${text.slice(0, 200)}`);
      }
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        throw new Error(`Webhook delivery timed out after 5s: ${url}`, { cause: err });
      }
      throw err;
    } finally {
      clearTimeout(timeout);
    }
  }
}

/** Singleton webhook queue instance. */
export const webhookQueue = new WebhookQueue();
