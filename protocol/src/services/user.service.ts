import db from '../lib/db';
import { users, userNotificationSettings, userProfiles, User, userConnectionEvents } from '../lib/schema';
import { eq, inArray, or, and } from 'drizzle-orm';
import { log } from '../lib/log';

/**
 * UserService
 * 
 * Manages basic CRUD operations for User entities.
 * 
 * ROLE:
 * - Data access layer for the `users` table.
 * - Graph resolution: `findWithGraph` joins User + Profile + Settings.
 */
export class UserService {
    async findById(userId: string) {
        log.info('[UserService] Finding user by ID', { userId });
        const result = await db.select().from(users).where(eq(users.id, userId)).limit(1);
        return result[0] || null;
    }

    /**
     * Resolves a full User Graph.
     * 
     * JOINS:
     * - `userProfiles` (for identity/bio)
     * - `userNotificationSettings`
     * 
     * @param userId - ID to find.
     * @returns User object merged with Profile and Settings, or null.
     */
    async findWithGraph(userId: string) {
        const userResult = await db.select({
            user: users,
            settings: userNotificationSettings,
            profile: userProfiles
        })
            .from(users)
            .leftJoin(userNotificationSettings, eq(users.id, userNotificationSettings.userId))
            .leftJoin(userProfiles, eq(users.id, userProfiles.userId))
            .where(eq(users.id, userId))
            .limit(1);

        if (userResult.length === 0) {
            return null;
        }

        const { user, settings, profile } = userResult[0];

        return {
            ...user,
            profile,
            notificationPreferences: settings?.preferences || {
                connectionUpdates: true,
                weeklyNewsletter: true,
            }
        };
    }

    async update(userId: string, data: Partial<User>) {
        log.info('[UserService] Updating user', { userId, fields: Object.keys(data) });
        const result = await db.update(users)
            .set({
                ...data,
                updatedAt: new Date()
            })
            .where(eq(users.id, userId))
            .returning();

        return result[0] || null;
    }

    async softDelete(userId: string) {
        log.info('[UserService] Soft deleting user', { userId });
        await db.update(users)
            .set({ deletedAt: new Date() })
            .where(eq(users.id, userId));
        return true;
    }

    /**
     * Get user details for newsletter (including settings and onboarding)
     */
    async getUserForNewsletter(userId: string) {
        const userRes = await db.select({
            id: users.id,
            email: users.email,
            name: users.name,
            intro: users.intro,
            timezone: users.timezone,
            lastSent: users.lastWeeklyEmailSentAt,
            prefs: userNotificationSettings.preferences,
            unsubscribeToken: userNotificationSettings.unsubscribeToken,
            onboarding: users.onboarding
        })
            .from(users)
            .leftJoin(userNotificationSettings, eq(users.id, userNotificationSettings.userId))
            .where(eq(users.id, userId))
            .limit(1);

        return userRes[0] || null;
    }

    /**
     * Get basic user info for multiple users (for partner lookup)
     */
    async getUsersBasicInfo(userIds: string[]) {
        if (userIds.length === 0) return [];
        return db.select({
            id: users.id,
            name: users.name,
            intro: users.intro
        })
            .from(users)
            .where(inArray(users.id, userIds));
    }

    /**
     * Update the last time a weekly email was sent
     */
    async updateLastWeeklyEmailSent(userId: string) {
        await db.update(users)
            .set({ lastWeeklyEmailSentAt: new Date() })
            .where(eq(users.id, userId));
    }

    /**
     * Ensure notification settings exist for a user
     */
    async ensureNotificationSettings(userId: string) {
        const [upsertedSettings] = await db.insert(userNotificationSettings)
            .values({
                userId,
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

        return upsertedSettings;
    }
    /**
     * Check if there is an existing connection event between two users
     */
    async checkConnectionEvent(user1Id: string, user2Id: string) {
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
}

export const userService = new UserService();
