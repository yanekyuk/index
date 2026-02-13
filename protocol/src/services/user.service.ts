import { log } from '../lib/log';
import { userDatabaseAdapter } from '../adapters/database.adapter';
import type { User } from '../schemas/database.schema';

const logger = log.service.from("UserService");

/**
 * UserService
 * 
 * Manages basic CRUD operations for User entities.
 * Uses UserDatabaseAdapter for all database operations.
 * 
 * ROLE:
 * - Data access layer for the `users` table.
 * - Graph resolution: `findWithGraph` joins User + Profile + Settings.
 */
export class UserService {
  constructor(private db = userDatabaseAdapter) {}
    async findById(userId: string) {
        logger.info('[UserService] Finding user by ID', { userId });
        return this.db.findById(userId);
    }

    /**
     * Find multiple users by IDs (public profile fields only, for batch API).
     */
    async findByIds(userIds: string[]) {
        if (userIds.length === 0) return [];
        return this.db.findByIds(userIds);
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
        return this.db.findWithGraph(userId);
    }

    async update(userId: string, data: Partial<User>) {
        logger.info('[UserService] Updating user', { userId, fields: Object.keys(data) });
        return this.db.update(userId, data);
    }

    async softDelete(userId: string) {
        logger.info('[UserService] Soft deleting user', { userId });
        await this.db.softDelete(userId);
        return true;
    }

    /**
     * Get user details for newsletter (including settings and onboarding)
     */
    async getUserForNewsletter(userId: string) {
        return this.db.getUserForNewsletter(userId);
    }

    /**
     * Get basic user info for multiple users (for partner lookup)
     */
    async getUsersBasicInfo(userIds: string[]) {
        return this.db.getUsersBasicInfo(userIds);
    }

    /**
     * Update the last time a weekly email was sent
     */
    async updateLastWeeklyEmailSent(userId: string) {
        await this.db.updateLastWeeklyEmailSent(userId);
    }

    /**
     * Ensure notification settings exist for a user
     */
    async ensureNotificationSettings(userId: string) {
        return this.db.ensureNotificationSettings(userId);
    }

    /**
     * Update notification preferences for a user (upsert)
     */
    async updateNotificationPreferences(userId: string, preferences: { connectionUpdates?: boolean; weeklyNewsletter?: boolean }) {
        return this.db.updateNotificationPreferences(userId, preferences as import('../schemas/database.schema').NotificationPreferences);
    }

}

export const userService = new UserService();
