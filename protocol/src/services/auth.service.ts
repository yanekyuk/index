import { userDatabaseAdapter } from '../adapters/database.adapter';
import { OnboardingState } from '../schemas/database.schema';
import { privyClient } from '../lib/privy';
import { log } from '../lib/log';

const logger = log.service.from("AuthService");
/**
 * AuthService
 * 
 * Manages user authentication lifecycle and onboarding state.
 * Uses UserDatabaseAdapter for database operations.
 * 
 * RESPONSIBILITIES:
 * - Bootstrapping new users (Default preferences).
 * - Managing Onboarding State transitions.
 * - Bridging with Privy (External Auth Provider).
 */
export class AuthService {
    constructor(private db = userDatabaseAdapter) {}

    /**
     * Initializes default notification settings for a new user.
     * Idempotent (safe to call multiple times).
     * 
     * @param userId - The internal DB UUID of the user.
     */
    async setupDefaultPreferences(userId: string) {
        logger.info('[AuthService] Setting up default preferences', { userId });
        await this.db.setupDefaultNotificationSettings(userId);
    }

    /**
     * Pure function to merge new onboarding state updates.
     * 
     * @param currentOnboarding - Existing state JSON.
     * @param update - Partial update to apply.
     * @returns New merged OnboardingState object.
     */
    calculateOnboardingState(currentOnboarding: OnboardingState, update: OnboardingState): OnboardingState {
        const { completedAt, flow, currentStep, indexId, invitationCode } = update;
        return {
            ...currentOnboarding,
            ...(completedAt !== undefined && { completedAt }),
            ...(flow !== undefined && { flow }),
            ...(currentStep !== undefined && { currentStep }),
            ...(indexId !== undefined && { indexId }),
            ...(invitationCode !== undefined && { invitationCode }),
        };
    }

    async getPrivyUser(privyId: string) {
        logger.info('[AuthService] Fetching privy user', { privyId });
        return await privyClient.getUserById(privyId);
    }
}
