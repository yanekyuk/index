import { Job } from 'bullmq';
import { NewsletterJobData, WeeklyCycleJobData, addNewsletterJob } from './newsletter.queue';
import db from '../drizzle/drizzle';
import { users, userNotificationSettings, intentStakes, intents, userConnectionEvents, intentStakeItems } from '../../schemas/database.schema';
import { eq, gt, inArray, or, and } from 'drizzle-orm';
import { synthesizeNewsletterVibeCheck } from '../synthesis';
import { weeklyNewsletterTemplate, Match } from '../email/templates/weekly-newsletter.template';
import { sendEmail } from '../email/transport.helper';
import { toZonedTime, format } from 'date-fns-tz';
import { getConnectingStakes, stakeOtherUsers } from '../stakes';

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

        // 1. Get stakes to identify ACTIVE users (optimization)
        const sevenDaysAgo = new Date();
        sevenDaysAgo.setDate(sevenDaysAgo.getDate() - daysSince);

        console.time('FetchStakes');
        const recentStakes = await db.select({
            id: intentStakes.id,
            createdAt: intentStakes.createdAt
        })
            .from(intentStakes)
            .where(gt(intentStakes.createdAt, sevenDaysAgo));

        // We need all participants of these stakes to be our "target audience"
        // But simply getting stake IDs isn't enough, we need the users.
        // Let's just get ALL users who have intents in these stakes.
        // Or simpler: Iterate over all users who have active intents.
        // Let's stick to the "users involved in recent stakes" heuristic.

        // Improve optimization: Direct query for affected users
        const affectedUserRows = await db.selectDistinct({ userId: intents.userId })
            .from(intentStakeItems)
            .innerJoin(intents, eq(intents.id, intentStakeItems.intentId))
            .where(inArray(intentStakeItems.stakeId, recentStakes.map(s => s.id)));

        const affectedUserIds = affectedUserRows.map(r => r.userId);
        console.timeEnd('FetchStakes');

        console.log(`[NewsletterWorker] Found ${recentStakes.length} recent stakes involving ${affectedUserIds.length} users`);

        console.time('ProcessMatches');
        let dispatchedCount = 0;

        // Fetch user preferences/details in bulk or per user? 
        // Per user is safer for memory if we have many users.

        for (const userId of affectedUserIds) {
            // Get user details
            const userRes = await db.select({
                id: users.id,
                email: users.email,
                name: users.name,
                timezone: users.timezone,
                lastSent: users.lastWeeklyEmailSentAt,
                prefs: userNotificationSettings.preferences,
                onboarding: users.onboarding
            })
                .from(users)
                .leftJoin(userNotificationSettings, eq(users.id, userNotificationSettings.userId))
                .where(eq(users.id, userId))
                .limit(1);

            if (!userRes.length) continue;
            const user = userRes[0];

            // Filter 1: Opt-in
            if (user.prefs?.weeklyNewsletter === false) continue;

            // Filter 2: Onboarding
            if (!user.onboarding?.completedAt) continue;

            // Filter 3: Schedule (Timezone check)
            const userTimezone = user.timezone || 'UTC';
            const zonedDate = toZonedTime(now, userTimezone);
            const dayOfWeek = format(zonedDate, 'i', { timeZone: userTimezone });
            const hour = format(zonedDate, 'H', { timeZone: userTimezone });
            const minute = format(zonedDate, 'm', { timeZone: userTimezone });
            const targetDayISO = targetDay === 0 ? '7' : targetDay.toString();

            if (!force && (dayOfWeek !== targetDayISO || parseInt(hour, 10) !== targetHour || parseInt(minute, 10) !== targetMinute)) {
                continue;
            }

            // Filter 4: Frequency (Don't send if sent recently, unless force)
            // But getConnectingStakes(createdAfter) handles "new matches only".
            // However, we still probably don't want to email twice in a week if they just got one?
            // "Weekly" implies once a week. 
            // If they got one yesterday, skip?
            // Let's rely on the schedule check mostly. But if manual force, maybe check lastSent?
            // The original logic checked `stake.createdAt > p1LastSent`.

            const lastSent = user.lastSent ? new Date(user.lastSent) : sevenDaysAgo;
            const searchSince = force ? sevenDaysAgo : lastSent;

            // 2. Get Secure Matches via Protocol
            // strict: Checks index access, excludes self, excludes single-user stakes, excludes already connected
            const stakes = await getConnectingStakes({
                authenticatedUserId: userId,
                userIds: [userId],
                createdAfter: searchSince,
                excludeConnected: true,
                requireAllUsers: true // Just to be safe, though with 1 user it's implied
            });

            if (!stakes.length) continue;

            // 3. Prepare Candidates
            // We need to fetch partner details
            const partnerIds = new Set<string>();
            stakes.forEach(s => stakeOtherUsers(s, userId).forEach(uid => partnerIds.add(uid)));

            if (partnerIds.size === 0) continue;

            const partners = await db.select({
                id: users.id,
                name: users.name,
                intro: users.intro
            })
                .from(users)
                .where(inArray(users.id, [...partnerIds]));

            const partnerMap = new Map(partners.map(p => [p.id, p]));
            const candidates: NewsletterJobData['candidates'] = [];
            const seenPartners = new Set<string>();

            // Convert high-value stakes to candidates
            for (const stake of stakes) {
                const partnerId = stakeOtherUsers(stake, userId)[0]; // Assume pair for now, or first other
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
            await addNewsletterJob({
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

        const API_URL = process.env.API_URL || 'https://index.network.api';
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
