import { Job } from 'bullmq';
import { QueueFactory } from '../lib/bullmq/bullmq';
import { weeklyNewsletterTemplate, Match } from '../lib/email/templates/weekly-newsletter.template';
import { sendEmail } from '../lib/email/transport.helper';
import { toZonedTime, format } from 'date-fns-tz';
import { getConnectingStakes, stakeOtherUsers } from '../lib/stakes';
import { log } from '../lib/log';
import { userService } from '../services/user.service';
import { stakeService } from '../services/stake.service';

export const NEWSLETTER_QUEUE_NAME = 'weekly-newsletter-queue';

export interface NewsletterCandidate {
  userId: string;
  userName: string;
  userRole?: string;
  stakeId: string;
  reasoning?: string;
}

export interface NewsletterJobData {
  recipientId: string;
  candidates: NewsletterCandidate[];
  force?: boolean;
}

export interface WeeklyCycleJobData {
  timestamp: number;
  force?: boolean;
  daysSince?: number;
}

export type NewsletterJob = Job<NewsletterJobData | WeeklyCycleJobData>;

/**
 * Weekly Newsletter Processing Queue.
 * 
 * RESPONSIBILITIES:
 * 1. `start_weekly_cycle`: Triggered by CRON. Identifies users who need an email.
 * 2. `process_newsletter`: Generates and sends the actual email for a specific user.
 * 
 * CORE LOGIC:
 * - Timezone Aware: Sends emails at 9 AM in the user's local time.
 * - Vibe Checks: Generates dynamic "Why we matched you" text for every candidate.
 */
export const newsletterQueue = QueueFactory.createQueue<NewsletterJobData | WeeklyCycleJobData>(NEWSLETTER_QUEUE_NAME);

// Processor Helpers
function stripNamePrefix(text: string, name: string) {
  if (!text || !name) return text;

  const lowerText = text.toLowerCase();
  const lowerName = name.toLowerCase();

  // Try different separator variants
  const separators = [' - ', ' – ', ' — ', ' : ', '- ', '– ', '— ', ': ', '-', '–', '—', ':'];

  for (const sep of separators) {
    const prefix = lowerName + sep;
    if (lowerText.startsWith(prefix)) {
      return text.slice(prefix.length).trimStart();
    }
  }

  return text;
}

function parseNewsletterSchedule() {
  const schedule = process.env.WEEKLY_NEWSLETTER_CRON_DATE || '0 9 * * 1';
  const parts = schedule.split(' ');
  let targetDay = 1;
  let targetHour = 9;
  let targetMinute = 0;

  if (parts.length >= 5) {
    const m = parseInt(parts[0], 10);
    const h = parseInt(parts[1], 10);
    const d = parseInt(parts[4], 10);
    if (!isNaN(m) && !isNaN(h) && !isNaN(d)) {
      targetHour = h;
      targetDay = d === 7 ? 0 : d;
      targetMinute = m;
    }
  }
  return { targetDay, targetHour, targetMinute };
}

// Processor Function
export async function newsletterProcessor(job: Job) {
  if (job.name === 'start_weekly_cycle') {
    return processWeeklyCycle(job as Job<WeeklyCycleJobData>);
  } else if (job.name === 'process_newsletter') {
    return processNewsletterJob(job as Job<NewsletterJobData>);
  } else {
    log.warn(`[NewsletterWorker] Unknown job name: ${job.name}`);
  }
}

async function processNewsletterJob(job: Job<NewsletterJobData>) {
  const { recipientId, candidates, force } = job.data;
  console.log(`[NewsletterWorker] Processing email job ${job.id} for recipient ${recipientId} with ${candidates.length} candidates`);

  try {
    // 1. Fetch Recipient Details
    const recipient = await userService.getUserForNewsletter(recipientId);

    if (!recipient || !recipient.email) {
      console.error(`[NewsletterWorker] User ${recipientId} not found or no email`);
      return;
    }

    if (recipient.prefs?.weeklyNewsletter === false) {
      console.log(`[NewsletterWorker] User ${recipient.email} opted out`);
      return;
    }

    if (!recipient.onboarding?.completedAt) {
      console.log(`[NewsletterWorker] User ${recipient.email} has not completed onboarding. Skipping.`);
      return;
    }

    let unsubscribeToken = recipient.unsubscribeToken;
    if (!unsubscribeToken) {
      console.log(`[NewsletterWorker] User ${recipientId} missing unsubscribe token. Creating settings row.`);
      const upsertedSettings = await userService.ensureNotificationSettings(recipientId);
      if (upsertedSettings) {
        unsubscribeToken = upsertedSettings.unsubscribeToken;
      }
    }

    // 2. Process Candidates (Vibe Check)
    const matches: Match[] = [];
    const processedCandidateIds = new Set<string>();

    console.time(`[NewsletterWorker] VibeChecks-${recipientId}`);
    const vibeResults = await Promise.all(candidates.map(async (candidate) => {
      if (processedCandidateIds.has(candidate.userId)) return null;
      processedCandidateIds.add(candidate.userId);

      try {
        const synthesisResult = await stakeService.generateSynthesis(
          { id: recipientId, name: recipient.name },
          { id: candidate.userId, name: candidate.userName, intro: candidate.userRole },
          {
            vibeOptions: { style: 'newsletter' }
          }
        );
        return {
          candidate,
          synthesisResult
        };
      } catch (err) {
        console.error(`[NewsletterWorker] Failed vibe check for ${candidate.userId}`, err);
        return null;
      }
    }));
    console.timeEnd(`[NewsletterWorker] VibeChecks-${recipientId}`);

    for (const res of vibeResults) {
      if (!res || !res.synthesisResult.synthesis) continue;

      const { candidate, synthesisResult } = res;
      const role = synthesisResult.subject
        ? stripNamePrefix(synthesisResult.subject, candidate.userName)
        : (candidate.userRole || 'Index User');

      matches.push({
        name: candidate.userName,
        role: role,
        reasoning: synthesisResult.synthesis
      });
    }

    if (matches.length === 0) {
      console.log(`[NewsletterWorker] No successful matches generated for ${recipient.email}`);
      return;
    }

    console.log(`[NewsletterWorker] Preparing email for ${recipient.email} with ${matches.length} matches`);

    const API_URL = process.env.API_URL || 'https://index.network.api';
    let unsubscribeUrl: string | undefined;
    if (unsubscribeToken) {
      unsubscribeUrl = `${API_URL}/api/notifications/unsubscribe?token=${unsubscribeToken}&type=weeklyNewsletter`;
    }

    const template = weeklyNewsletterTemplate(recipient.name, matches, unsubscribeUrl);

    if (process.env.NODE_ENV === 'development' && process.env.ENABLE_EMAIL_TESTING !== 'true') {
      console.log(`[DEV] Would send email to ${recipient.email} (${matches.length} matches)`);
    } else {
      await sendEmail({
        to: recipient.email,
        subject: template.subject,
        html: template.html,
        text: template.text,
        headers: unsubscribeUrl ? {
          'List-Unsubscribe': `<mailto:hello@index.network?subject=Unsubscribe>, <${unsubscribeUrl}>`,
          'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click'
        } : undefined
      });

      await userService.updateLastWeeklyEmailSent(recipientId);

      console.log(`[NewsletterWorker] Sent newsletter to ${recipient.email}`);
    }

  } catch (error) {
    console.error(`[NewsletterWorker] Error processing job for ${recipientId}:`, error);
    throw error;
  }
}

/**
 * Job: `start_weekly_cycle`
 * 
 * The "Orchestrator" job. Runs once (e.g., Monday morning UTC) but dispatches per-user jobs
 * based on their specific Timezone and Schedule preferences.
 * 
 * OPTIMIZATIONS:
 * - Only queries users active in the last 7 days (via Stakes).
 * - Filters by `userNotificationSettings`.
 */
async function processWeeklyCycle(job: Job<WeeklyCycleJobData>) {
  const { force, daysSince = 7 } = job.data;
  const now = new Date();

  console.log(`[NewsletterWorker] Starting weekly cycle (Force: ${force})`);
  console.time('WeeklyCycle');

  try {
    const { targetDay, targetHour, targetMinute } = parseNewsletterSchedule();

    // 1. Get stakes to identify ACTIVE users (optimization)
    console.time('FetchStakes');
    const recentStakes = await stakeService.getRecentStakes(daysSince);

    // Improve optimization: Direct query for affected users
    const affectedUserIds = await stakeService.getAffectedUserIdsFromStakes(recentStakes.map(s => s.id));
    console.timeEnd('FetchStakes');

    console.log(`[NewsletterWorker] Found ${recentStakes.length} recent stakes involving ${affectedUserIds.length} users`);

    console.time('ProcessMatches');
    let dispatchedCount = 0;

    for (const userId of affectedUserIds) {
      // Get user details
      const user = await userService.getUserForNewsletter(userId);

      if (!user) continue;

      if (user.prefs?.weeklyNewsletter === false) continue;
      if (!user.onboarding?.completedAt) continue;

      // Schedule Check
      const userTimezone = user.timezone || 'UTC';
      const zonedDate = toZonedTime(now, userTimezone);
      const dayOfWeek = format(zonedDate, 'i', { timeZone: userTimezone });
      const hour = format(zonedDate, 'H', { timeZone: userTimezone });
      const minute = format(zonedDate, 'm', { timeZone: userTimezone });
      const targetDayISO = targetDay === 0 ? '7' : targetDay.toString();

      if (!force && (dayOfWeek !== targetDayISO || parseInt(hour, 10) !== targetHour || parseInt(minute, 10) !== targetMinute)) {
        continue;
      }

      const lastSent = user.lastSent ? new Date(user.lastSent) : new Date(Date.now() - daysSince * 24 * 60 * 60 * 1000);
      const searchSince = force ? new Date(Date.now() - daysSince * 24 * 60 * 60 * 1000) : lastSent;

      // 2. Get Secure Matches via Protocol
      const stakes = await getConnectingStakes({
        authenticatedUserId: userId,
        userIds: [userId],
        createdAfter: searchSince,
        excludeConnected: true,
        requireAllUsers: true
      });

      if (!stakes.length) continue;

      // 3. Prepare Candidates
      const partnerIds = new Set<string>();
      stakes.forEach(s => stakeOtherUsers(s, userId).forEach(uid => partnerIds.add(uid)));

      if (partnerIds.size === 0) continue;

      const partners = await userService.getUsersBasicInfo([...partnerIds]);
      const partnerMap = new Map(partners.map(p => [p.id, p]));

      const candidates: NewsletterJobData['candidates'] = [];
      const seenPartners = new Set<string>();

      for (const stake of stakes) {
        const partnerId = stakeOtherUsers(stake, userId)[0];
        if (!partnerId || seenPartners.has(partnerId)) continue;

        const partner = partnerMap.get(partnerId);
        if (!partner) continue;

        seenPartners.add(partnerId);
        candidates.push({
          userId: partner.id,
          userName: partner.name,
          userRole: partner.intro || undefined,
          stakeId: stake.id,
          reasoning: stake.reasoning ?? undefined,
        });
      }

      if (candidates.length === 0) continue;

      // 4. Dispatch
      await addJob('process_newsletter', {
        recipientId: userId,
        candidates,
        force
      });
      dispatchedCount++;
    }

    console.timeEnd('ProcessMatches');
    console.log(`[NewsletterWorker] Weekly cycle completed. Dispatched ${dispatchedCount} jobs.`);
    console.timeEnd('WeeklyCycle');

  } catch (error) {
    console.error('[NewsletterWorker] Error in weekly cycle:', error);
    throw error;
  }
}


export const newsletterWorker = QueueFactory.createWorker<NewsletterJobData | WeeklyCycleJobData>(NEWSLETTER_QUEUE_NAME, newsletterProcessor, {
  concurrency: 5,
  limiter: {
    max: 10,
    duration: 1000
  },
  lockDuration: 60000,
});
export const queueEvents = QueueFactory.createQueueEvents(NEWSLETTER_QUEUE_NAME);

/**
 * Add a job to the Newsletter Queue.
 *
 * @param name - The name of the job ('process_newsletter' or 'start_weekly_cycle').
 * @param data - The payload for the job.
 * @param priority - Optional priority level (higher number = higher priority).
 * @returns The created Job instance.
 */
export async function addJob(
  name: string,
  data: NewsletterJobData | WeeklyCycleJobData,
  priority: number = 0
): Promise<Job> {
  const options: any = {
    priority: priority > 0 ? priority : undefined,
  };

  if (name === 'process_newsletter') {
    const d = data as NewsletterJobData;
    const now = new Date();
    const dateStr = now.toISOString().split('T')[0].replace(/-/g, '');
    options.jobId = `newsletter-${d.recipientId}-${dateStr}`;
  } else if (name === 'start_weekly_cycle') {
    options.removeOnComplete = true;
  }

  return newsletterQueue.add(name, data, options);
}
