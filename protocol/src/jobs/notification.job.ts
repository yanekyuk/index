import { ChatDatabaseAdapter } from '../adapters/database.adapter';
import { userService } from '../services/user.service';
import { addEmailJob } from '../lib/email/queue/email.queue';
import { opportunityNotificationTemplate } from '../lib/email/templates/opportunity-notification.template';
import { emitOpportunityNotification } from '../lib/notification-events';
import { getRedisClient } from '../lib/redis';
import { log } from '../lib/log';
import type { NotificationJobData } from '../queues/notification.types';

const logger = log.job.from("notification");

const API_URL = process.env.API_URL || 'https://index.network';
const FRONTEND_URL = process.env.FRONTEND_URL || 'https://index.network';

/** Digest list key prefix: digest:opportunities:{recipientId}. List of opportunityId strings, TTL 7 days. */
const DIGEST_LIST_PREFIX = 'digest:opportunities:';
/** Dedupe key prefix: digest:dedupe:{recipientId}:{opportunityId}. SET NX EX to avoid duplicate digest entries on retries. */
const DIGEST_DEDUPE_PREFIX = 'digest:dedupe:';
/** Email dedupe key prefix: email:opportunity:dedupe:{recipientId}:{opportunityId}. */
const EMAIL_OPPORTUNITY_DEDUPE_PREFIX = 'email:opportunity:dedupe:';
const DIGEST_TTL_SEC = 7 * 24 * 3600;

/**
 * Process a single opportunity notification job.
 * - immediate: WebSocket broadcast (emit event for WS server to push to client)
 * - high: Send email via Resend (enqueue to email queue)
 * - low: Add to Redis list for weekly digest (no immediate email)
 */
export async function processOpportunityNotification(
  data: NotificationJobData,
  deps?: { database?: ChatDatabaseAdapter }
): Promise<void> {
  const { opportunityId, recipientId, priority } = data;
  const db = deps?.database ?? new ChatDatabaseAdapter();

  logger.info('[NotificationJob] Processing opportunity notification', {
    opportunityId,
    recipientId,
    priority,
  });

  const opportunity = await db.getOpportunity(opportunityId);
  if (!opportunity) {
    logger.warn('[NotificationJob] Opportunity not found, skipping', { opportunityId });
    return;
  }

  const summary =
    opportunity.interpretation.reasoning ??
    'A new match that might be relevant to you.';

  switch (priority) {
    case 'immediate': {
      emitOpportunityNotification({ opportunityId, recipientId });
      logger.info('[NotificationJob] Emitted opportunity notification (WebSocket)', {
        opportunityId,
        recipientId,
      });
      break;
    }
    case 'high': {
      await sendHighPriorityEmail(recipientId, opportunityId, summary);
      break;
    }
    case 'low': {
      await addToDigest(recipientId, opportunityId);
      break;
    }
    default: {
      logger.warn('[NotificationJob] Unknown priority, treating as low', { priority });
      await addToDigest(recipientId, opportunityId);
    }
  }
}

async function sendHighPriorityEmail(
  recipientId: string,
  opportunityId: string,
  summary: string
): Promise<void> {
  const recipient = await userService.getUserForNewsletter(recipientId);
  if (!recipient?.email) {
    logger.warn('[NotificationJob] Recipient not found or no email, skipping email', {
      recipientId,
    });
    return;
  }
  if (!recipient.onboarding?.completedAt) {
    logger.info('[NotificationJob] Recipient has not completed onboarding, skipping email', {
      recipientId,
    });
    return;
  }
  if (recipient.prefs?.connectionUpdates === false) {
    logger.info('[NotificationJob] Recipient has connection/opportunity updates disabled', {
      recipientId,
    });
    return;
  }

  const opportunityUrl = `${FRONTEND_URL}/opportunities/${opportunityId}`;
  let unsubscribeUrl: string | undefined;
  if (recipient.unsubscribeToken) {
    unsubscribeUrl = `${API_URL}/api/notifications/unsubscribe?token=${recipient.unsubscribeToken}&type=connectionUpdates`;
  }

  const redis = getRedisClient();
  const emailDedupeKey = `${EMAIL_OPPORTUNITY_DEDUPE_PREFIX}${recipientId}:${opportunityId}`;
  const setResult = await redis.set(emailDedupeKey, '1', 'EX', DIGEST_TTL_SEC, 'NX');
  if (setResult !== 'OK') {
    logger.info('[NotificationJob] Skipped duplicate opportunity email (dedupe key already set)', {
      recipientId,
      opportunityId,
    });
    return;
  }

  const template = opportunityNotificationTemplate(
    recipient.name ?? 'there',
    summary,
    opportunityUrl,
    unsubscribeUrl
  );

  await addEmailJob(
    {
      to: recipient.email,
      subject: template.subject,
      html: template.html,
      text: template.text,
      headers: unsubscribeUrl
        ? {
            'List-Unsubscribe': `<mailto:hello@index.network?subject=Unsubscribe>, <${unsubscribeUrl}>`,
            'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
          }
        : undefined,
    },
    { jobId: `opportunity-email:${recipientId}:${opportunityId}` }
  );
  logger.info('[NotificationJob] Enqueued high-priority opportunity email', {
    recipientId,
    opportunityId,
  });
}

async function addToDigest(recipientId: string, opportunityId: string): Promise<void> {
  try {
    const redis = getRedisClient();
    const dedupeKey = `${DIGEST_DEDUPE_PREFIX}${recipientId}:${opportunityId}`;
    const setResult = await redis.set(dedupeKey, '1', 'EX', DIGEST_TTL_SEC, 'NX');
    if (setResult !== 'OK') {
      logger.info('[NotificationJob] Skipped duplicate digest entry (dedupe key already set)', {
        recipientId,
        opportunityId,
      });
      return;
    }
    const listKey = `${DIGEST_LIST_PREFIX}${recipientId}`;
    await redis.rpush(listKey, opportunityId);
    await redis.expire(listKey, DIGEST_TTL_SEC);
    logger.info('[NotificationJob] Added opportunity to weekly digest list', {
      recipientId,
      opportunityId,
    });
  } catch (err) {
    logger.error('[NotificationJob] Failed to add to digest list', {
      recipientId,
      opportunityId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
