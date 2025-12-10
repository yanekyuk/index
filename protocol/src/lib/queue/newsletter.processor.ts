import { Job } from 'bullmq';
import { NewsletterJobData, WeeklyCycleJobData, addNewsletterJob } from './newsletter.queue';
import db from '../db';
import { users, userNotificationSettings, intentStakes, intents, userConnectionEvents } from '../schema'; // Assuming schema path
import { eq, gt, inArray, or, and } from 'drizzle-orm';
import { synthesizeNewsletterVibeCheck } from '../synthesis';
import { weeklyNewsletterTemplate, Match } from '../email/templates/weekly-newsletter.template';
import { sendEmail } from '../email/transport.helper';
import { toZonedTime, format } from 'date-fns-tz';

// Helper to strip name prefix
function stripNamePrefix(text: string, name: string) {
    if (!text || !name) return text;
    
    const lowerText = text.toLowerCase();
    const lowerName = name.toLowerCase();
    
    // Try different separator variants (with various spacing patterns)
    const separators = [' - ', ' – ', ' — ', ' : ', '- ', '– ', '— ', ': ', '-', '–', '—', ':'];
    
    for (const sep of separators) {
        const prefix = lowerName + sep;
        if (lowerText.startsWith(prefix)) {
            return text.slice(prefix.length).trimStart();
        }
    }
    
    return text;
}

// Helper to get users involved in a stake
async function getUsersForStake(stakeId: string, intentIds: string[]) {
    const stakeIntents = await db.select({
        userId: intents.userId,
        userName: users.name,
        userEmail: users.email,
        userRole: users.intro,
        userTimezone: users.timezone,
        userLastWeeklyEmailSentAt: users.lastWeeklyEmailSentAt,
        userOnboarding: users.onboarding,
        notificationPreferences: userNotificationSettings.preferences,
        unsubscribeToken: userNotificationSettings.unsubscribeToken,
        intentId: intents.id
    })
        .from(intents)
        .innerJoin(users, eq(intents.userId, users.id))
        .leftJoin(userNotificationSettings, eq(users.id, userNotificationSettings.userId))
        .where(inArray(intents.id, intentIds));

    if (stakeIntents.length !== 2) return null;
    if (stakeIntents[0].userId === stakeIntents[1].userId) return null;

    return stakeIntents;
}

// Check if there is an existing connection event between two users
async function hasConnectionEvent(user1Id: string, user2Id: string) {
    const events = await db.select({ id: userConnectionEvents.id })
        .from(userConnectionEvents)
        .where(
            or(
                and(
                    eq(userConnectionEvents.initiatorUserId, user1Id),
                    eq(userConnectionEvents.receiverUserId, user2Id)
                ),
                and(
                    eq(userConnectionEvents.initiatorUserId, user2Id),
                    eq(userConnectionEvents.receiverUserId, user1Id)
                )
            )
        )
        .limit(1);

    return events.length > 0;
}

// Helper to parse cron string (reused for time logic)
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

/**
 * Sandboxed processor for Weekly Newsletter
 */
export default async function processor(job: Job) {
    if (job.name === 'start_weekly_cycle') {
        return processWeeklyCycle(job as Job<WeeklyCycleJobData>);
    } else if (job.name === 'process_newsletter') {
        return processNewsletterJob(job as Job<NewsletterJobData>);
    } else {
        console.warn(`[NewsletterWorker] Unknown job name: ${job.name}`);
    }
}

async function processWeeklyCycle(job: Job<WeeklyCycleJobData>) {
    const { force, daysSince = 7 } = job.data;
    const now = new Date();

    console.log(`[NewsletterWorker] Starting weekly cycle (Force: ${force})`);
    console.time('WeeklyCycle');

    try {
        const { targetDay, targetHour, targetMinute } = parseNewsletterSchedule();

        // 1. Get stakes
        const sevenDaysAgo = new Date();
        sevenDaysAgo.setDate(sevenDaysAgo.getDate() - daysSince);

        console.time('FetchStakes');
        const recentStakes = await db.select()
            .from(intentStakes)
            .where(gt(intentStakes.createdAt, sevenDaysAgo));
        console.timeEnd('FetchStakes');

        console.log(`[NewsletterWorker] Found ${recentStakes.length} stakes`);

        console.time('ProcessStakes');
        const userMatches = new Map<string, { user: any, candidates: any[], matchedUserIds: Set<string> }>();

        for (const stake of recentStakes) {
            const participants = await getUsersForStake(stake.id, stake.intents);
            if (!participants) continue;

            const [p1, p2] = participants;

            const connected = await hasConnectionEvent(p1.userId, p2.userId);
            if (connected) continue;

            // Init map entries
            if (!userMatches.has(p1.userId)) {
                userMatches.set(p1.userId, { user: p1, candidates: [], matchedUserIds: new Set() });
            }
            const p1Data = userMatches.get(p1.userId)!;

            if (!userMatches.has(p2.userId)) {
                userMatches.set(p2.userId, { user: p2, candidates: [], matchedUserIds: new Set() });
            }
            const p2Data = userMatches.get(p2.userId)!;

            // Check timing
            let [p1LastSent, p2LastSent] = [sevenDaysAgo, sevenDaysAgo];
            if (!force) {
                p1LastSent = p1.userLastWeeklyEmailSentAt ? new Date(p1.userLastWeeklyEmailSentAt) : sevenDaysAgo;
                p2LastSent = p2.userLastWeeklyEmailSentAt ? new Date(p2.userLastWeeklyEmailSentAt) : sevenDaysAgo;
            }

            let p1NeedsMatch = stake.createdAt > p1LastSent && !p1Data.matchedUserIds.has(p2.userId);
            let p2NeedsMatch = stake.createdAt > p2LastSent && !p2Data.matchedUserIds.has(p1.userId);

            if (p1NeedsMatch && p1.notificationPreferences?.weeklyNewsletter === false) p1NeedsMatch = false;
            if (p2NeedsMatch && p2.notificationPreferences?.weeklyNewsletter === false) p2NeedsMatch = false;

            if (p1NeedsMatch) {
                p1Data.candidates.push({
                    userId: p2.userId,
                    userName: p2.userName,
                    userRole: p2.userRole,
                    stakeId: stake.id,
                    reasoning: stake.reasoning
                });
                p1Data.matchedUserIds.add(p2.userId);
            }

            if (p2NeedsMatch) {
                p2Data.candidates.push({
                    userId: p1.userId,
                    userName: p1.userName,
                    userRole: p1.userRole,
                    stakeId: stake.id,
                    reasoning: stake.reasoning
                });
                p2Data.matchedUserIds.add(p1.userId);
            }
        }
        console.timeEnd('ProcessStakes');

        console.time('DispatchQueue');
        let dispatchedCount = 0;

        for (const [userId, data] of userMatches.entries()) {
            if (data.candidates.length < 1) continue;

            // Onboarding check - enforced even if force is true
            if (!data.user.userOnboarding?.completedAt) {
                // console.log(`Skipping ${data.user.userEmail} - Onboarding not completed`);
                continue;
            }

            // Timezone check
            const userTimezone = data.user.userTimezone || 'UTC';
            const zonedDate = toZonedTime(now, userTimezone);
            const dayOfWeek = format(zonedDate, 'i', { timeZone: userTimezone });
            const hour = format(zonedDate, 'H', { timeZone: userTimezone });
            const minute = format(zonedDate, 'm', { timeZone: userTimezone });
            const targetDayISO = targetDay === 0 ? '7' : targetDay.toString();

            if (!force && (dayOfWeek !== targetDayISO || parseInt(hour, 10) !== targetHour || parseInt(minute, 10) !== targetMinute)) {
                continue;
            }

            await addNewsletterJob({
                recipientId: userId,
                candidates: data.candidates,
                force
            });
            dispatchedCount++;
        }
        console.timeEnd('DispatchQueue');
        console.log(`[NewsletterWorker] Weekly cycle completed. Dispatched ${dispatchedCount} jobs.`);
        console.timeEnd('WeeklyCycle');

    } catch (error) {
        console.error('[NewsletterWorker] Error in weekly cycle:', error);
        throw error;
    }
}

async function processNewsletterJob(job: Job<NewsletterJobData>) {
    const { recipientId, candidates, force } = job.data;
    console.log(`[NewsletterWorker] Processing email job ${job.id} for recipient ${recipientId} with ${candidates.length} candidates`);

    try {
        // 1. Fetch Recipient Details
        const recipientStore = await db.select({
            id: users.id,
            email: users.email,
            name: users.name,
            intro: users.intro, // Role proxy
            timezone: users.timezone,
            onboarding: users.onboarding,
            unsubscribeToken: userNotificationSettings.unsubscribeToken,
            preferences: userNotificationSettings.preferences
        })
            .from(users)
            .leftJoin(userNotificationSettings, eq(users.id, userNotificationSettings.userId))
            .where(eq(users.id, recipientId))
            .limit(1);

        const recipient = recipientStore[0];

        if (!recipient || !recipient.email) {
            console.error(`[NewsletterWorker] User ${recipientId} not found or no email`);
            return;
        }

        if (recipient.preferences?.weeklyNewsletter === false) {
            console.log(`[NewsletterWorker] User ${recipient.email} opted out`);
            return;
        }

        // Strict Onboarding Check
        if (!recipient.onboarding?.completedAt) {
            console.log(`[NewsletterWorker] User ${recipient.email} has not completed onboarding. Skipping.`);
            return;
        }

        // Lazy creation of notification settings if missing (legacy fix)
        if (!recipient.unsubscribeToken) {
            console.log(`[NewsletterWorker] User ${recipientId} missing unsubscribe token. Creating settings row.`);
            const [upsertedSettings] = await db.insert(userNotificationSettings)
                .values({
                    userId: recipientId,
                    preferences: {
                        connectionUpdates: true,
                        weeklyNewsletter: true,
                    }
                })
                .onConflictDoUpdate({
                    target: userNotificationSettings.userId,
                    set: {
                        updatedAt: new Date()
                    }
                })
                .returning({
                    unsubscribeToken: userNotificationSettings.unsubscribeToken
                });

            if (upsertedSettings) {
                recipient.unsubscribeToken = upsertedSettings.unsubscribeToken;
            }
        }

        // 2. Process Candidates (Vibe Check)
        const matches: Match[] = [];
        const processedCandidateIds = new Set<string>();

        // Process in parallel with concurrency limit if needed, 
        // but for now Promise.all for all candidates (usually small number < 10)
        // Adjust if candidates list is huge.

        console.time(`[NewsletterWorker] VibeChecks-${recipientId}`);
        const vibeResults = await Promise.all(candidates.map(async (candidate) => {
            // Avoid double processing
            if (processedCandidateIds.has(candidate.userId)) return null;
            processedCandidateIds.add(candidate.userId);

            try {
                // Fetch candidate details to get name if not passed fully? 
                // synthesizeNewsletterVibeCheck takes IDs and fetches data internally.
                const synthesisResult = await synthesizeNewsletterVibeCheck(recipientId, candidate.userId);

                // We need candidate name for the template. 
                // Getting it from 'candidate.userName' passed in job data would be efficient.
                // But let's trust we passed it.
                // Or we could fetch it here if we want to be safe.
                // Let's assume we fetch minimal needed or reuse what calls synthesize.

                // Wait, synthesizeNewsletterVibeCheck returns { synthesis, subject }.
                // We also need the candidate's name to display in the email: "Matches: Bob - Expert in..."
                // The candidate object in job data has userName.

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

            // Format the match object
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

        // 3. Prepare Email
        console.log(`[NewsletterWorker] Preparing email for ${recipient.email} with ${matches.length} matches`);

        const API_URL = process.env.API_URL || 'https://api.index.network';
        let unsubscribeUrl: string | undefined;
        if (recipient.unsubscribeToken) {
            unsubscribeUrl = `${API_URL}/api/notifications/unsubscribe?token=${recipient.unsubscribeToken}&type=weeklyNewsletter`;
        }

        const template = weeklyNewsletterTemplate(recipient.name, matches, unsubscribeUrl);

        // 4. Send Email
        if (process.env.NODE_ENV === 'development' && process.env.ENABLE_EMAIL_TESTING !== 'true') {
            console.log(`[DEV] Would send email to ${recipient.email} (${matches.length} matches)`);
            console.log(`Subject: ${template.subject}`);
            console.log(`Unsubscribe: ${unsubscribeUrl}`);
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

            // 5. Update Stat
            await db.update(users)
                .set({ lastWeeklyEmailSentAt: new Date() })
                .where(eq(users.id, recipientId));

            console.log(`[NewsletterWorker] Sent newsletter to ${recipient.email}`);
        }

    } catch (error) {
        console.error(`[NewsletterWorker] Error processing job for ${recipientId}:`, error);
        throw error;
    }
}
