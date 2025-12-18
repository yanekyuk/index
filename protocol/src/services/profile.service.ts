import db from '../lib/db';
import { userProfiles, intents, userNotificationSettings, UserSocials, NotificationPreferences, User } from '../lib/schema';
import { eq, and, isNull, sql, ne } from 'drizzle-orm';
import { ProfileGenerator } from '../agents/profile/generator/profile.generator';
import { searchUser } from '../lib/parallel/parallel';
import { json2md } from '../lib/json2md/json2md';
import { UserMemoryProfile, ActiveIntent } from '../agents/intent/manager/intent.manager.types';
import { IntentManager } from '../agents/intent/manager/intent.manager';
import { checkAndTriggerSocialSync } from '../lib/integrations/social-sync';
import { HydeGeneratorAgent } from '../agents/profile/generator/hyde/hyde.generator';
import { generateEmbedding } from '../lib/embeddings';

export interface UpdateProfileDto {
    name?: string;
    intro?: string;
    avatar?: string;
    location?: string;
    timezone?: string;
    socials?: UserSocials;
    notificationPreferences?: NotificationPreferences;
}

export interface GenerateProfileCallbacks {
    onStatus: (msg: string) => void;
    onResult: (data: { intro: string; location: string; intents: any[] }) => void;
    onError: (msg: string) => void;
}

export class ProfileService {

    // updatedUser is the User object AFTER it has been updated in the users table by UserService
    // oldUser is the User object BEFORE the update (used for checking social changes)
    async updateProfile(userId: string, data: UpdateProfileDto, updatedUser: User, oldUser: User | null) {
        const { name, intro, location, socials, notificationPreferences } = data;

        // Upsert into 'user_profiles' table
        if (intro !== undefined || location !== undefined || name !== undefined) {
            const existingProfileRes = await db.select().from(userProfiles).where(eq(userProfiles.userId, userId)).limit(1);
            const existingIdentity = existingProfileRes[0]?.identity || { name: updatedUser.name, bio: '', location: '' };

            const newIdentity = {
                name: name || existingIdentity.name,
                bio: intro !== undefined ? intro : existingIdentity.bio,
                location: location !== undefined ? location : existingIdentity.location
            };

            await db.insert(userProfiles)
                .values({
                    userId: userId,
                    identity: newIdentity,
                })
                .onConflictDoUpdate({
                    target: userProfiles.userId,
                    set: {
                        identity: newIdentity,
                        updatedAt: new Date()
                    }
                });

            // Trigger background intent generation if bio (intro) changed
            if (intro !== undefined) {
                this.triggerBackgroundIntentGeneration(userId, intro, updatedUser.name);
            }
        }

        // Update notification preferences
        let updatedPreferences = null;
        if (notificationPreferences !== undefined) {
            const existingSettings = await db.select()
                .from(userNotificationSettings)
                .where(eq(userNotificationSettings.userId, userId))
                .limit(1);

            if (existingSettings.length > 0) {
                const settings = await db.update(userNotificationSettings)
                    .set({
                        preferences: notificationPreferences,
                        updatedAt: new Date()
                    })
                    .where(eq(userNotificationSettings.userId, userId))
                    .returning();
                updatedPreferences = settings[0].preferences;
            } else {
                const settings = await db.insert(userNotificationSettings)
                    .values({
                        userId: userId,
                        preferences: notificationPreferences
                    })
                    .returning();
                updatedPreferences = settings[0].preferences;
            }
        } else {
            const settings = await db.select()
                .from(userNotificationSettings)
                .where(eq(userNotificationSettings.userId, userId))
                .limit(1);
            updatedPreferences = settings[0]?.preferences || {
                connectionRequest: true,
                connectionAccepted: true,
                connectionRejected: true,
                weeklyNewsletter: true,
            };
        }

        if (socials !== undefined) {
            // Check old socials to see if we need to sync
            const oldUserSocials = oldUser ? oldUser.socials : null;
            checkAndTriggerSocialSync(userId, oldUserSocials, socials);
        }

        return {
            ...updatedUser,
            notificationPreferences: updatedPreferences
        };
    }

    private async triggerBackgroundIntentGeneration(userId: string, intro: string, userName: string | null) {
        (async () => {
            try {
                console.log('Triggering background intent generation for profile update', userId);

                const [profileData, activeIntentsData] = await Promise.all([
                    db.select().from(userProfiles).where(eq(userProfiles.userId, userId)).limit(1),
                    db.select().from(intents).where(and(
                        eq(intents.userId, userId),
                        isNull(intents.archivedAt)
                    ))
                ]);

                if (!profileData.length) return;
                let userProfile = profileData[0];

                const hasAttributes = userProfile.attributes &&
                    ((userProfile.attributes.interests?.length || 0) > 0 || (userProfile.attributes.skills?.length || 0) > 0);
                const hasNarrative = !!userProfile.narrative;

                if (!hasAttributes || !hasNarrative) {
                    console.log('Profile incomplete, triggering repair via ProfileGenerator', userId);
                    const bioToUse = intro || userProfile.identity?.bio || '';

                    if (bioToUse) {
                        try {
                            const generator = new ProfileGenerator();
                            const generated = await generator.run(bioToUse);

                            const fixedIdentity = {
                                ...generated.profile.identity,
                                location: generated.profile.identity.location || ''
                            };

                            await db.update(userProfiles)
                                .set({
                                    identity: fixedIdentity,
                                    narrative: generated.profile.narrative,
                                    attributes: generated.profile.attributes,
                                    updatedAt: new Date()
                                })
                                .where(eq(userProfiles.id, userProfile.id));

                            userProfile = {
                                ...userProfile,
                                identity: fixedIdentity,
                                narrative: generated.profile.narrative,
                                attributes: generated.profile.attributes
                            };
                            console.log('Profile repaired successfully');
                        } catch (e) {
                            console.error('Profile repair failed:', e);
                        }
                    }
                }

                const attributes = userProfile.attributes || { interests: [], skills: [] };
                const identity = userProfile.identity || { name: userName || 'User', bio: '', location: '' };

                const memoryProfile: UserMemoryProfile = {
                    userId: userId,
                    identity: {
                        name: identity.name,
                        bio: identity.bio,
                        location: identity.location
                    },
                    narrative: userProfile.narrative || undefined,
                    attributes: {
                        interests: attributes.interests || [],
                        skills: attributes.skills || [],
                        goals: []
                    }
                };

                const activeIntents: ActiveIntent[] = activeIntentsData.map(i => ({
                    id: i.id,
                    description: i.payload,
                    status: 'active',
                    created_at: i.createdAt.getTime()
                }));

                const manager = new IntentManager();
                const content = null;

                const result = await manager.processIntent(content, memoryProfile, activeIntents);
                console.log('Intent detection result:', JSON.stringify(result));

                if (result.actions && result.actions.length > 0) {
                    for (const action of result.actions) {
                        if (action.type === 'create') {
                            await db.insert(intents).values({
                                userId: userId,
                                payload: action.payload,
                                summary: action.payload, // Ensure summary is populated
                            });
                            console.log(`Created intent: ${action.payload}`);
                        }
                    }
                }

                // --- HyDE Generation ---
                console.log('Generating HyDE description and embedding...');
                const hydeGenerator = new HydeGeneratorAgent();
                const hydeDescription = await hydeGenerator.generate(memoryProfile);

                if (hydeDescription) {
                    console.log(`HyDE Description Length: ${hydeDescription.length} chars. Preview: "${hydeDescription.substring(0, 100)}..."`);
                    const hydeEmbedding = await generateEmbedding(hydeDescription);

                    await db.update(userProfiles)
                        .set({
                            hydeDescription,
                            hydeEmbedding,
                            updatedAt: new Date()
                        })
                        .where(eq(userProfiles.userId, userId));

                    console.log('✅ HyDE profile updated.');
                }
                // -----------------------

            } catch (err) {
                console.error('Background intent generation failed:', err);
            }
        })();
    }

    async generateProfile(user: User, callbacks: GenerateProfileCallbacks) {
        try {
            const socials = (user.socials || {}) as { x?: string; linkedin?: string; github?: string; websites?: string[] };

            callbacks.onStatus('Searching for public information...');

            let query = `Find information about the person named ${user.name || 'Unknown'}.`;
            if (user.email) query += `\nEmail: ${user.email}`;
            if (socials.linkedin) query += `\nLinkedIn: ${socials.linkedin}`;
            if (socials.x) query += `\nTwitter: ${socials.x}`;
            if (socials.github) query += `\nGitHub: ${socials.github}`;
            if (socials.websites?.length) query += `\nWebsites: ${socials.websites.join(', ')}`;

            const searchResult = await searchUser(query);

            callbacks.onStatus('Analyzing profile data...');

            const markdownData = json2md.fromObject(
                searchResult.results.map(r => ({
                    title: r.title,
                    content: r.excerpts.join('\n')
                }))
            );

            const generator = new ProfileGenerator();
            const result = await generator.run(markdownData);

            const fixedIdentity = {
                ...result.profile.identity,
                location: result.profile.identity.location || ''
            };

            await db.insert(userProfiles)
                .values({
                    userId: user.id,
                    identity: fixedIdentity,
                    narrative: result.profile.narrative,
                    attributes: result.profile.attributes,
                })
                .onConflictDoUpdate({
                    target: userProfiles.userId,
                    set: {
                        identity: fixedIdentity,
                        narrative: result.profile.narrative,
                        attributes: result.profile.attributes,
                        updatedAt: new Date(),
                    }
                });

            callbacks.onResult({
                intro: result.profile.identity.bio || '',
                location: result.profile.identity.location || '',
                intents: []
            });

        } catch (error) {
            callbacks.onError('Failed to generate summary');
        }
    }

    /**
     * Get profiles that do not have an embedding yet.
     */
    async getProfilesMissingEmbeddings() {
        return await db
            .select()
            .from(userProfiles)
            .where(isNull(userProfiles.embedding));
    }

    /**
     * Update the embedding for a specific user profile.
     */
    async updateProfileEmbedding(profileId: string, embedding: number[]) {
        await db.update(userProfiles)
            .set({ embedding })
            .where(eq(userProfiles.id, profileId));
    }

    /**
     * Update HyDE data for a profile.
     */
    async updateProfileHyde(profileId: string, hydeDescription: string, hydeEmbedding: number[]) {
        await db.update(userProfiles)
            .set({
                hydeDescription,
                hydeEmbedding,
                updatedAt: new Date()
            })
            .where(eq(userProfiles.id, profileId));
    }

    /**
     * Get all profiles that have an embedding.
     */
    async getAllProfilesWithEmbeddings() {
        return await db.select().from(userProfiles).where(sql`${userProfiles.embedding} IS NOT NULL`);
    }

    /**
     * Find similar profiles using vector similarity search.
     * Excludes the source user.
     */
    async findSimilarProfiles(sourceUserId: string, embedding: number[], limit: number = 20) {
        return await db
            .select({
                profile: userProfiles,
                distance: sql<number>`${userProfiles.embedding} <=> ${JSON.stringify(embedding)}`
            })
            .from(userProfiles)
            .where(and(
                sql`${userProfiles.embedding} IS NOT NULL`,
                ne(userProfiles.userId, sourceUserId)
            ))
            .orderBy(sql`${userProfiles.embedding} <=> ${JSON.stringify(embedding)}`)
            .limit(limit);
    }
}

