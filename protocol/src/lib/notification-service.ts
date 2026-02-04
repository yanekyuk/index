/**
 * @deprecated This module is deprecated.
 */
import db from './drizzle/drizzle';
import { users, intents, intentStakes, intentStakeItems, userNotificationSettings } from '../schemas/database.schema';
import { eq, sql, and, inArray } from 'drizzle-orm';
import {
    sendConnectionRequestEmail,
    sendConnectionAcceptedEmail
} from './email/email.module';
import { synthesizeVibeCheck, synthesizeIntro } from './synthesis';
import DOMPurify from 'isomorphic-dompurify';

async function checkStakeBetweenUsers(user1Id: string, user2Id: string): Promise<boolean> {
    const [user1Intents, user2Intents, stakes] = await Promise.all([
        db.select({ id: intents.id }).from(intents).where(eq(intents.userId, user1Id)),
        db.select({ id: intents.id }).from(intents).where(eq(intents.userId, user2Id)),
        db.select({ id: intentStakes.id })
            .from(intentStakes)
            .innerJoin(intentStakeItems, eq(intentStakeItems.stakeId, intentStakes.id))
            .where(and(
                // Filter to stakes involving both users
                inArray(intentStakeItems.userId, [user1Id, user2Id])
            ))
            .groupBy(intentStakes.id)
            .having(and(
                // Both users must be present
                sql`COUNT(DISTINCT ${intentStakeItems.userId}) = 2`
            ))
            .limit(1)
    ]);

    const user1IntentIds = user1Intents.map(i => i.id);
    const user2IntentIds = user2Intents.map(i => i.id);

    if (user1IntentIds.length === 0 || user2IntentIds.length === 0) {
        return false;
    }

    return stakes.length > 0;
}

async function waitForStake(user1Id: string, user2Id: string): Promise<boolean> {
    for (let i = 0; i < 6; i++) {
        const hasStake = await checkStakeBetweenUsers(user1Id, user2Id);
        if (hasStake) {
            return true;
        }
        if (i < 5) {
            await new Promise(resolve => setTimeout(resolve, 10000));
        }
    }
    return false;
}

// Helper to check user notification settings
async function checkConnectionUpdatesEnabled(userId: string): Promise<boolean> {
    const settings = await db.select({ preferences: userNotificationSettings.preferences })
        .from(userNotificationSettings)
        .where(eq(userNotificationSettings.userId, userId))
        .limit(1);

    // Default to true if no settings found or preference not set
    return settings[0]?.preferences?.connectionUpdates ?? true;
}

/**
 * @deprecated
 */
export async function sendConnectionRequestNotification(initiatorUserId: string, receiverUserId: string): Promise<void> {
    try {
        // Check if receiver has connection updates enabled
        const shouldSend = await checkConnectionUpdatesEnabled(receiverUserId);
        if (!shouldSend) {
            console.log(`User ${receiverUserId} has connection updates disabled, skipping connection request email`);
            return;
        }

        // Check for stake between users with retry logic
        const hasStake = await waitForStake(initiatorUserId, receiverUserId);
        if (!hasStake) {
            console.log('No stake found between users, skipping connection request email');
            return;
        }

        // Get initiator and receiver details
        const [initiator, receiver] = await Promise.all([
            db.select({ name: users.name }).from(users).where(eq(users.id, initiatorUserId)).limit(1),
            db.select({ name: users.name, email: users.email }).from(users).where(eq(users.id, receiverUserId)).limit(1)
        ]);

        if (!receiver[0]?.email || !initiator[0]?.name || !receiver[0]?.name) {
            console.log('Missing required user data for connection request email');
            return;
        }

        // Generate synthesis for the receiver
        const { synthesis: synthesisMarkdown, subject } = await synthesizeVibeCheck(
            receiverUserId,
            initiatorUserId,
            { vibeOptions: { characterLimit: 500 } }
        );

        // Strip links from markdown (replace [text](url) with text)
        const cleanMarkdown = synthesisMarkdown.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1');

        // Convert markdown to HTML
        const markedMod = await import('marked');
        // Handle both default export and named export variations
        const parse = markedMod.parse || (markedMod as any).default?.parse || (markedMod as any).marked?.parse;
        if (!parse) {
            console.error('Failed to load marked parser', markedMod);
            return;
        }
        const rawHtml = await parse(cleanMarkdown);
        const synthesis = DOMPurify.sanitize(rawHtml);

        await sendConnectionRequestEmail(
            receiver[0].email,
            initiator[0].name,
            receiver[0].name,
            synthesis,
            subject || 'New Connection Request'
        );
    } catch (error) {
        console.error('Failed to send connection request email:', error);
        throw error;
    }
}

/**
 * @deprecated
 */
export async function sendConnectionAcceptedNotification(accepterUserId: string, initiatorUserId: string): Promise<void> {
    try {
        // Check notification settings for both users
        const [accepterEnabled, initiatorEnabled] = await Promise.all([
            checkConnectionUpdatesEnabled(accepterUserId),
            checkConnectionUpdatesEnabled(initiatorUserId)
        ]);

        // Check for stake between users with retry logic
        const hasStake = await waitForStake(accepterUserId, initiatorUserId);
        if (!hasStake) {
            console.log('No stake found between users, skipping connection accepted email');
            return;
        }

        // Get accepter and initiator details including both email addresses
        const [accepter, initiator] = await Promise.all([
            db.select({ name: users.name, email: users.email }).from(users).where(eq(users.id, accepterUserId)).limit(1),
            db.select({ name: users.name, email: users.email }).from(users).where(eq(users.id, initiatorUserId)).limit(1)
        ]);

        if (!initiator[0]?.email || !accepter[0]?.email || !accepter[0]?.name || !initiator[0]?.name) {
            console.log('Missing required user data for connection accepted email');
            return;
        }

        // Generate intro synthesis
        const synthesisMarkdown = await synthesizeIntro(
            accepterUserId,
            initiatorUserId
        );

        // Convert markdown to HTML
        const markedMod = await import('marked');
        const parse = markedMod.parse || (markedMod as any).default?.parse || (markedMod as any).marked?.parse;
        if (!parse) {
            console.error('Failed to load marked parser', markedMod);
            return;
        }
        const rawHtml = await parse(synthesisMarkdown);
        const synthesis = DOMPurify.sanitize(rawHtml);

        // Send to initiator if enabled
        if (initiatorEnabled) {
            await sendConnectionAcceptedEmail(
                [initiator[0].email],
                initiator[0].name,
                accepter[0].name,
                synthesis
            );
        }

        // Send to accepter if enabled
        if (accepterEnabled) {
            await sendConnectionAcceptedEmail(
                [accepter[0].email],
                initiator[0].name,
                accepter[0].name,
                synthesis
            );
        }

    } catch (error) {
        console.error(`Failed to send connection accepted email: ${error}`);
        throw error;
    }
}
