import { userDatabaseAdapter } from '../adapters/database.adapter';
import { OnboardingState } from '../schemas/database.schema';
import { log } from '../lib/log';

const logger = log.service.from("AuthService");

export class AuthService {
    constructor(private db = userDatabaseAdapter) {}

    /**
     * Initializes default notification settings for a new user.
     * Called lazily on first /auth/me if not yet set up.
     */
    async setupDefaultPreferences(userId: string) {
        logger.info('[AuthService] Setting up default preferences', { userId });
        await this.db.setupDefaultNotificationSettings(userId);
    }

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
}

export const authService = new AuthService();
