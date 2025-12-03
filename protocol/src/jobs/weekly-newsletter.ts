import cron from 'node-cron';
import db from '../lib/db';
import { intentStakes, intents, users, userConnectionEvents } from '../lib/schema';
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
        intentId: intents.id
    })
        .from(intents)
        .innerJoin(users, eq(intents.userId, users.id))
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

export async function sendWeeklyNewsletter(now: Date = new Date()) {
    console.log('Starting weekly newsletter job...');
    try {
        // Optimization: Only run if it's possible to be Monday 9 AM anywhere on Earth
        // Window: Sunday 19:00 UTC (UTC+14) to Monday 21:00 UTC (UTC-12)
        const utcDay = now.getUTCDay(); // 0 = Sunday, 1 = Monday
        const utcHour = now.getUTCHours();

        const isSundayLate = utcDay === 0 && utcHour >= 19;
        const isMondayEarly = utcDay === 1 && utcHour <= 21;

        if (!isSundayLate && !isMondayEarly) {
            // console.log('Skipping weekly newsletter job - Outside of global Monday 9 AM window');
            return;
        }

        // 1. Get stakes created in the last 7 days (fallback) or since last email
        const sevenDaysAgo = new Date();
        sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

        // We fetch all recent stakes first, then filter per-user based on their last sent time
        const recentStakes = await db.select()
            .from(intentStakes)
            .where(gt(intentStakes.createdAt, sevenDaysAgo));

        console.log(`Found ${recentStakes.length} stakes from the last 7 days.`);

        const userMatches = new Map<string, { user: any, matches: Match[], matchedUserIds: Set<string> }>();

        for (const stake of recentStakes) {
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

            const p1NeedsMatch = stake.createdAt > p1LastSent && !p1Data.matchedUserIds.has(p2.userId);
            const p2NeedsMatch = stake.createdAt > p2LastSent && !p2Data.matchedUserIds.has(p1.userId);

            if (p1NeedsMatch || p2NeedsMatch) {
                // Fetch vibe checks in parallel if needed
                const [vibeForP1, vibeForP2] = await Promise.all([
                    p1NeedsMatch ? synthesizeVibeCheck(p1.userId, p2.userId) : Promise.resolve(null),
                    p2NeedsMatch ? synthesizeVibeCheck(p2.userId, p1.userId) : Promise.resolve(null)
                ]);

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

        // 4. Send emails
        for (const [userId, data] of userMatches.entries()) {
            if (data.matches.length < 1) continue;

            // Check if user has completed onboarding
            if (!data.user.userOnboarding?.completedAt) {
                // console.log(`Skipping ${data.user.userEmail} - Onboarding not completed`);
                continue;
            }

            // Check if it's Monday 9 AM in the user's timezone
            const userTimezone = data.user.userTimezone || 'UTC';
            // const now = new Date(); // Use the passed 'now'
            const zonedDate = toZonedTime(now, userTimezone);

            // format(zonedDate, 'i', { timeZone: userTimezone }) -> '1' for Monday
            // format(zonedDate, 'H', { timeZone: userTimezone }) -> '9' for 9 AM
            const dayOfWeek = format(zonedDate, 'i', { timeZone: userTimezone });
            const hour = format(zonedDate, 'H', { timeZone: userTimezone });

            // Monday is '1' in date-fns (ISO week)
            if (dayOfWeek !== '1' || hour !== '9') {
                // console.log(`Skipping ${data.user.userEmail} (Timezone: ${userTimezone}) - Local time is ${dayOfWeek} ${hour}:00`);
                continue;
            }

            console.log(`Preparing newsletter for ${data.user.userName} (${data.user.userEmail}) with ${data.matches.length} matches. Timezone: ${userTimezone}`);

            const template = weeklyNewsletterTemplate(data.user.userName, data.matches);

            if (process.env.NODE_ENV === 'development' && process.env.ENABLE_EMAIL_TESTING !== 'true') {
                console.log(`[DEV] Would send email to ${data.user.userEmail}:`);
                console.log(`Subject: ${template.subject}`);
                console.log(`Body preview: ${template.text.substring(0, 200)}...`);
            } else {
                await sendEmail({
                    to: data.user.userEmail,
                    subject: template.subject,
                    html: template.html,
                    text: template.text
                });

                // Update lastWeeklyEmailSentAt
                await db.update(users)
                    .set({ lastWeeklyEmailSentAt: new Date() })
                    .where(eq(users.id, userId));

                console.log(`Sent newsletter to ${data.user.userEmail}`);
            }
        }

        console.log('Weekly newsletter job completed.');

    } catch (error) {
        console.error('Error running weekly newsletter job:', error);
    }
}

// Schedule: Every hour
export const initWeeklyNewsletterJob = () => {
    // Run every hour at minute 0
    cron.schedule('0 * * * *', () => {
        sendWeeklyNewsletter();
    });
    console.log('📅 Weekly newsletter job scheduled (Hourly check)');
};
