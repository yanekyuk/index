import cron from 'node-cron';
import { addJob } from '../queues/newsletter.queue';
import { log } from '../lib/log';

// Helper to parse cron string "m h dom mon dow"
function parseNewsletterSchedule() {
  const schedule = process.env.WEEKLY_NEWSLETTER_CRON_DATE || '0 9 * * 1';
  const parts = schedule.split(' ');
  // Default to Monday 9am if invalid
  let targetDay = 1; // Monday
  let targetHour = 9;
  let targetMinute = 0;

  if (parts.length >= 5) {
    const m = parseInt(parts[0], 10);
    const h = parseInt(parts[1], 10);
    const d = parseInt(parts[4], 10);
    if (!isNaN(m) && !isNaN(h) && !isNaN(d)) {
      targetHour = h;
      targetDay = d === 7 ? 0 : d; // Normalize 7 to 0 (Sunday)
      targetMinute = m;
    }
  }
  return { targetDay, targetHour, targetMinute };
}

export async function sendWeeklyNewsletter(now: Date = new Date(), force: boolean = false, daysSince: number = 7) {
  console.time('WeeklyNewsletterTrigger');
  log.info('[NewsletterJob] Triggering weekly newsletter cycle...');
  try {
    const { targetDay, targetHour } = parseNewsletterSchedule();

    // Optimization: Only run if it's possible to be TargetDay TargetHour anywhere on Earth
    // Window: TargetUTC - 14h to TargetUTC + 12h
    const utcDay = now.getUTCDay(); // 0 = Sunday, 1 = Monday
    const utcHour = now.getUTCHours();

    const currentWeeklyHour = utcDay * 24 + utcHour;
    const targetWeeklyHour = targetDay * 24 + targetHour;
    const hoursInWeek = 168;

    // Calculate difference accounting for week wrap
    // diff will be (current - target) in hours
    let diff = (currentWeeklyHour - targetWeeklyHour + hoursInWeek) % hoursInWeek;
    // Normalize to [-hoursInWeek/2, hoursInWeek/2] to handle wrap around
    if (diff > hoursInWeek / 2) diff -= hoursInWeek;

    // Check if we are within the window [-14, +12]
    if (!force && (diff < -14 || diff > 12)) {
      log.info('[NewsletterJob] Skipping weekly newsletter job - Outside of global window');
      console.timeEnd('WeeklyNewsletterTrigger');
      return;
    }

    // Dispatch the "start weekly cycle" job
    await addJob('start_weekly_cycle', {
      timestamp: now.getTime(),
      force: force,
      daysSince: daysSince
    });

    log.info('[NewsletterJob] Weekly newsletter cycle enqueued.');
    console.timeEnd('WeeklyNewsletterTrigger');

  } catch (error) {
    log.error('[NewsletterJob] Error triggering weekly newsletter:', { error });
    console.timeEnd('WeeklyNewsletterTrigger');
  }
}

// Schedule: Every hour at the configured minute
export const initWeeklyNewsletterJob = () => {
  const { targetMinute } = parseNewsletterSchedule();
  // Run every hour at the configured minute
  cron.schedule(`${targetMinute} * * * *`, () => {
    sendWeeklyNewsletter();
  });
  log.info(`📅 [NewsletterJob] Weekly newsletter job scheduled (Hourly check at minute ${targetMinute})`);
};
