import cron from 'node-cron';
import db from '../lib/db';
import { intentStakes, intents, users, userConnectionEvents, userNotificationSettings } from '../lib/schema';
import { sendEmail } from '../lib/email/transport.helper';
import { weeklyNewsletterTemplate, Match } from '../lib/email/templates/weekly-newsletter.template';
import { and, eq, gt, inArray, or, sql, desc } from 'drizzle-orm';
import { toZonedTime, format } from 'date-fns-tz';
import { synthesizeVibeCheck } from '../lib/synthesis';

function stripNamePrefix(text: string, name: string) {
    if (!text || !name) return text;
    const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(`^${escapedName}\\s*-\\s*`, 'i');
    return text.replace(regex, '');
}

// Helper to get users involved in a stake
async function getUsersForStake(stakeId: string, intentIds: string[]) {
    const stakeIntents = await db.select({
        userId: intents.userId,
        userName: users.name,
        userEmail: users.email,
        userRole: users.intro, // Using intro as a proxy for role/title for now
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

    // We expect exactly 2 users for a stake
    if (stakeIntents.length !== 2) return null;

    // Ensure we have unique users (in case a user matches with themselves, which shouldn't happen but good to be safe)
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
    console.time('WeeklyNewsletterJob');
    console.log('Starting weekly newsletter job...');
    try {
        const { targetDay, targetHour, targetMinute } = parseNewsletterSchedule();

        // Optimization: Only run if it's possible to be TargetDay TargetHour anywhere on Earth
        // Window: TargetUTC - 14h to TargetUTC + 12h
        const utcDay = now.getUTCDay(); // 0 = Sunday, 1 = Monday
        const utcHour = now.getUTCHours();
        const utcMinute = now.getUTCMinutes();

        const currentWeeklyHour = utcDay * 24 + utcHour;
        const targetWeeklyHour = targetDay * 24 + targetHour;
        const hoursInWeek = 168;

        // Calculate difference accounting for week wrap
        // diff will be (current - target) in hours
        let diff = (currentWeeklyHour - targetWeeklyHour + hoursInWeek) % hoursInWeek;
        // Normalize to [-hoursInWeek/2, hoursInWeek/2] to handle wrap around
        if (diff > hoursInWeek / 2) diff -= hoursInWeek;

        // Check if we are within the window [-14, +12]
        // -14 means current is 14 hours BEFORE target (UTC+14 is at target)
        // +12 means current is 12 hours AFTER target (UTC-12 is at target)
        if (!force && (diff < -14 || diff > 12)) {
            // console.log('Skipping weekly newsletter job - Outside of global window');
            console.log('Skipping weekly newsletter job - Outside of global window');
            console.timeEnd('WeeklyNewsletterJob');
            return;
        }

        // 1. Get stakes created in the last 7 days (fallback) or since last email
        const sevenDaysAgo = new Date();
        sevenDaysAgo.setDate(sevenDaysAgo.getDate() - daysSince);

        // We fetch all recent stakes first, then filter per-user based on their last sent time
        console.time('FetchStakes');
        const recentStakes = await db.select()
            .from(intentStakes)
            .where(gt(intentStakes.createdAt, sevenDaysAgo));

        console.timeEnd('FetchStakes');
        console.log(`Found ${recentStakes.length} stakes from the last 7 days.`);

        console.time('ProcessStakes');

        const userMatches = new Map<string, { user: any, matches: Match[], matchedUserIds: Set<string> }>();

        let stakeIndex = 0;
        for (const stake of recentStakes) {
            stakeIndex++;
            if (stakeIndex % 10 === 0) console.log(`Processing stake ${stakeIndex}/${recentStakes.length}`);
            const participants = await getUsersForStake(stake.id, stake.intents);
            if (!participants) continue;

            const [p1, p2] = participants;

            // 2. Check for existing connections
            const connected = await hasConnectionEvent(p1.userId, p2.userId);
            if (connected) {
                console.log(`Skipping stake ${stake.id} because ${p1.userName} and ${p2.userName} are already connected/skipped.`);
                continue;
            }

            // 3. Add to user matches
            // For P1, match is P2
            if (!userMatches.has(p1.userId)) {
                userMatches.set(p1.userId, { user: p1, matches: [], matchedUserIds: new Set() });
            }
            const p1Data = userMatches.get(p1.userId)!;

            // For P2, match is P1
            if (!userMatches.has(p2.userId)) {
                userMatches.set(p2.userId, { user: p2, matches: [], matchedUserIds: new Set() });
            }
            const p2Data = userMatches.get(p2.userId)!;

            // Check if we need to process matches
            const p1LastSent = p1.userLastWeeklyEmailSentAt ? new Date(p1.userLastWeeklyEmailSentAt) : sevenDaysAgo;
            const p2LastSent = p2.userLastWeeklyEmailSentAt ? new Date(p2.userLastWeeklyEmailSentAt) : sevenDaysAgo;

            let p1NeedsMatch = stake.createdAt > p1LastSent && !p1Data.matchedUserIds.has(p2.userId);
            let p2NeedsMatch = stake.createdAt > p2LastSent && !p2Data.matchedUserIds.has(p1.userId);

            if (p1NeedsMatch || p2NeedsMatch) {
                // Check if users have opted out before doing expensive work
                if (p1.notificationPreferences?.weeklyNewsletter === false) {
                    // console.log(`Skipping match for ${p1.userEmail} - opted out of weekly newsletter`);
                    p1NeedsMatch = false;
                }
                if (p2.notificationPreferences?.weeklyNewsletter === false) {
                    // console.log(`Skipping match for ${p2.userEmail} - opted out of weekly newsletter`);
                    p2NeedsMatch = false;
                }
            }

            if (p1NeedsMatch || p2NeedsMatch) {
                // Fetch vibe checks in parallel if needed
                console.time(`SynthesizeVibeCheck-${stake.id}`);
                const [vibeForP1, vibeForP2] = await Promise.all([
                    p1NeedsMatch ? synthesizeVibeCheck(p1.userId, p2.userId) : Promise.resolve(null),
                    p2NeedsMatch ? synthesizeVibeCheck(p2.userId, p1.userId) : Promise.resolve(null)
                ]);
                console.timeEnd(`SynthesizeVibeCheck-${stake.id}`);

                if (p1NeedsMatch) {
                    const role = vibeForP1?.subject ? stripNamePrefix(vibeForP1.subject, p2.userName) : (p2.userRole || 'Index User');
                    p1Data.matches.push({
                        name: p2.userName,
                        role: role,
                        reasoning: vibeForP1?.synthesis || stake.reasoning
                    });
                    p1Data.matchedUserIds.add(p2.userId);
                }

                if (p2NeedsMatch) {
                    const role = vibeForP2?.subject ? stripNamePrefix(vibeForP2.subject, p1.userName) : (p1.userRole || 'Index User');
                    p2Data.matches.push({
                        name: p1.userName,
                        role: role,
                        reasoning: vibeForP2?.synthesis || stake.reasoning
                    });
                    p2Data.matchedUserIds.add(p1.userId);
                }
            }
        }

        console.timeEnd('ProcessStakes');

        // 4. Send emails
        console.time('SendEmails');
        for (const [userId, data] of userMatches.entries()) {
            if (data.matches.length < 1) continue;

            // Check if user has completed onboarding
            if (!data.user.userOnboarding?.completedAt) {
                // console.log(`Skipping ${data.user.userEmail} - Onboarding not completed`);
                continue;
            }

            // Check if it's Target Day and Target Hour in the user's timezone
            const userTimezone = data.user.userTimezone || 'UTC';
            // const now = new Date(); // Use the passed 'now'
            const zonedDate = toZonedTime(now, userTimezone);

            // format(zonedDate, 'i', { timeZone: userTimezone }) -> '1' for Monday
            // format(zonedDate, 'H', { timeZone: userTimezone }) -> '9' for 9 AM
            const dayOfWeek = format(zonedDate, 'i', { timeZone: userTimezone });
            const hour = format(zonedDate, 'H', { timeZone: userTimezone });
            const minute = format(zonedDate, 'm', { timeZone: userTimezone });

            // format 'i' returns 1(Mon)..7(Sun)
            // targetDay is 0(Sun)..6(Sat)
            const targetDayISO = targetDay === 0 ? '7' : targetDay.toString();

            // Skip time check if force is true
            if (!force && (dayOfWeek !== targetDayISO || parseInt(hour, 10) !== targetHour || parseInt(minute, 10) !== targetMinute)) {
                // console.log(`Skipping ${data.user.userEmail} (Timezone: ${userTimezone}) - Local time is ${dayOfWeek} ${hour}:${minute}`);
                continue;
            }

            console.log(`Preparing newsletter for ${data.user.userName} (${data.user.userEmail}) with ${data.matches.length} matches. Timezone: ${userTimezone}`);

            const API_URL = process.env.API_URL || 'https://api.index.network';
            let unsubscribeUrl: string | undefined;
            if (data.user.unsubscribeToken) {
                unsubscribeUrl = `${API_URL}/api/notifications/unsubscribe?token=${data.user.unsubscribeToken}&type=weeklyNewsletter`;
            }

            const template = weeklyNewsletterTemplate(data.user.userName, data.matches, unsubscribeUrl);

            // If we are in dev and email testing is NOT explicitly enabled, just log.
            // But if it IS enabled, we fall through to sendEmail which handles the redirection.
            if (process.env.NODE_ENV === 'development' && process.env.ENABLE_EMAIL_TESTING !== 'true') {
                console.log(`[DEV] Would send email to ${data.user.userEmail}:`);
                console.log(`Subject: ${template.subject}`);
                console.log(`Body preview: ${template.text.substring(0, 200)}...`);
                console.log(`Unsubscribe: ${unsubscribeUrl}`);
                console.log(`(Set ENABLE_EMAIL_TESTING=true to actually send)`);
            } else {
                try {
                    await sendEmail({
                        to: data.user.userEmail,
                        subject: template.subject,
                        html: template.html,
                        text: template.text,
                        headers: unsubscribeUrl ? {
                            'List-Unsubscribe': `<mailto:hello@index.network?subject=Unsubscribe>, <${unsubscribeUrl}>`,
                            'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click'
                        } : undefined
                    });

                    // Update lastWeeklyEmailSentAt
                    await db.update(users)
                        .set({ lastWeeklyEmailSentAt: new Date() })
                        .where(eq(users.id, userId));

                    console.log(`Sent newsletter to ${data.user.userEmail}`);
                } catch (err) {
                    console.error(`Failed to send newsletter to ${data.user.userEmail} (userId: ${userId})`, err);
                }
            }
        }

        console.timeEnd('SendEmails');
        console.log('Weekly newsletter job completed.');
        console.timeEnd('WeeklyNewsletterJob');

    } catch (error) {
        console.error('Error running weekly newsletter job:', error);
        console.timeEnd('WeeklyNewsletterJob');
    }
}

// Schedule: Every hour at the configured minute
export const initWeeklyNewsletterJob = () => {
    const { targetMinute } = parseNewsletterSchedule();
    // Run every hour at the configured minute
    cron.schedule(`${targetMinute} * * * *`, () => {
        sendWeeklyNewsletter();
    });
    console.log(`📅 Weekly newsletter job scheduled (Hourly check at minute ${targetMinute})`);
};
