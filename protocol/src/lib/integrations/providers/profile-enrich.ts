import { log } from '../../log';
import { generateSummaryWithIntents, GenerateSummaryInput } from '../../parallels';
import { IntentService } from '../../intent-service';
import db from '../../db';
import { users } from '../../schema';
import { eq, isNull, and } from 'drizzle-orm';

export interface ProfileEnrichResult {
    intentsGenerated: number;
    introUpdated: boolean;
    locationUpdated: boolean;
    success: boolean;
    error?: string;
}

/**
 * Helper function to prepare input for generateSummaryWithIntents
 */
function prepareSummaryInput(user: typeof users.$inferSelect): GenerateSummaryInput {
    const socials = user.socials || {};
    const input: GenerateSummaryInput = {};

    if (user.name?.trim()) {
        input.name = user.name.trim();
    }

    if (user.email?.trim()) {
        input.email = user.email.trim();
    }

    // Convert LinkedIn username to URL if needed
    if (socials.linkedin) {
        const linkedinValue = String(socials.linkedin).trim();
        if (linkedinValue) {
            input.linkedin_url = linkedinValue.startsWith('http')
                ? linkedinValue
                : `https://www.linkedin.com/in/${linkedinValue}`;
        }
    }

    // Convert Twitter username to URL if needed
    if (socials.x) {
        const twitterValue = String(socials.x).trim();
        if (twitterValue) {
            if (twitterValue.startsWith('http')) {
                input.twitter_url = twitterValue;
            } else {
                const username = twitterValue.replace(/^@/, '');
                input.twitter_url = `https://x.com/${username}`;
            }
        }
    }

    return input;
}


/**
 * High-level function: Complete profile enrichment workflow
 * Uses generateSummaryWithIntents to generate intro, location, and intents.
 * Updates intro and location fields, and creates new intents.
 * This is the main entry point that all triggers should use
 */
export async function enrichUserProfile(userId: string, generateIntents: boolean = true): Promise<ProfileEnrichResult> {
    try {
        // Get user from database
        const userRecords = await db.select()
            .from(users)
            .where(and(eq(users.id, userId), isNull(users.deletedAt)))
            .limit(1);

        if (userRecords.length === 0) {
            return { intentsGenerated: 0, introUpdated: false, locationUpdated: false, success: false, error: 'User not found' };
        }

        const user = userRecords[0];
        const input = prepareSummaryInput(user);

        // Ensure at least one field is provided
        if (!input.name && !input.email && !input.linkedin_url && !input.twitter_url) {
            return { intentsGenerated: 0, introUpdated: false, locationUpdated: false, success: false, error: 'No valid input data available' };
        }

        log.info('Generating profile enrichment data', { userId });

        // Call generateSummaryWithIntents
        const result = await generateSummaryWithIntents(input);
        if (!result) {
            return { intentsGenerated: 0, introUpdated: false, locationUpdated: false, success: false, error: 'Failed to generate profile data' };
        }

        const { intro, location, intents } = result;

        // Step 1: Process generated intents
        let intentsGenerated = 0;
        if (intents && generateIntents) {
            const existingIntents = await IntentService.getUserIntents(userId);

            for (const intentData of intents) {
                if (!existingIntents.has(intentData.intent)) {
                    // Map confidence from 'low'|'medium'|'high' to number (0-1) if needed, 
                    // but IntentService.createIntent expects number? 
                    // Let's check intent-service.ts. I'll assume number or mapped.
                    // InferredIntent from intent_inferrer uses number.
                    // GeneratedIntent from parallels uses string enum.
                    // I'll map it: high=0.9, medium=0.7, low=0.4

                    let confidence = 0.7;
                    if (intentData.confidence === 'high') confidence = 0.9;
                    else if (intentData.confidence === 'low') confidence = 0.4;

                    await IntentService.createIntent({
                        payload: intentData.intent,
                        userId,
                        sourceId: userId,
                        sourceType: 'integration',
                        confidence,
                        inferenceType: 'explicit', // Assuming explicit for now as they come from summary
                    });
                    existingIntents.add(intentData.intent);
                    intentsGenerated++;
                }
            }
        }

        // Step 2: Update intro and location fields
        const updates: Partial<typeof users.$inferInsert> = { updatedAt: new Date() };
        let introUpdated = false;
        let locationUpdated = false;

        // Only update intro if user doesn't have one and result is valid
        if (!user.intro && intro) {
            updates.intro = intro;
            introUpdated = true;
        }

        // Only update location if user hasn't manually set it and result is valid
        if (!user.location && location) {
            updates.location = location;
            locationUpdated = true;
        }

        if (introUpdated || locationUpdated) {
            await db.update(users)
                .set(updates)
                .where(eq(users.id, userId));
        }

        log.info('Profile enrichment complete', { userId, intentsGenerated, introUpdated, locationUpdated });

        return {
            intentsGenerated,
            introUpdated,
            locationUpdated,
            success: true,
        };
    } catch (error) {
        log.error('Profile enrichment error', { userId, error: (error as Error).message });
        return {
            intentsGenerated: 0,
            introUpdated: false,
            locationUpdated: false,
            success: false,
            error: (error as Error).message,
        };
    }
}
