import { Job } from 'bullmq';
import { QueueFactory } from '../lib/bullmq/bullmq';
import { log } from '../lib/log';
import { profileService } from '../services/profile.service';
import { intentService } from '../services/intent.service';

export const PROFILE_QUEUE_NAME = 'profile-update';

export interface ProfileUpdateJobData {
  userId: string;
  intro: string;
  userName: string | null;
}

/**
 * Profile Update Queue.
 * 
 * RESPONSIBILITIES:
 * 1. Repair profile using AI if incomplete
 * 2. Generate inferred intents
 * 3. Update HyDE embedding
 */
export const profileQueue = QueueFactory.createQueue<ProfileUpdateJobData>(PROFILE_QUEUE_NAME);

// Processor Function
export async function profileProcessor(job: Job<ProfileUpdateJobData>) {
  const { userId, intro, userName } = job.data;
  log.info(`[ProfileWorker] Processing job ${job.id} for user ${userId}`);

  try {
    // 1. Repair Profile if needed
    const userProfile = await profileService.repairProfileIfIncomplete(userId, intro, userName);

    if (!userProfile) {
      log.warn(`[ProfileWorker] Profile not found for user ${userId}, aborting job`);
      return;
    }

    // 2. Generate Intent Data from Profile
    log.info(`[ProfileWorker] Generating intent data for user ${userId}...`);
    const newIntents = await profileService.generateIntentDataFromProfile(userId, userProfile);
    log.info(`[ProfileWorker] Generated ${newIntents.length} intents.`);

    // 3. Create Intents Orchestration
    if (newIntents.length > 0) {
      log.info(`[ProfileWorker] Creating ${newIntents.length} inferred intents`);

      for (const intentOptions of newIntents) {
        try {
          await intentService.createIntent(intentOptions);
          log.info(`[ProfileWorker] Created inferred intent: "${intentOptions.payload}"`);
        } catch (err) {
          log.error(`[ProfileWorker] Failed to create inferred intent`, { error: err });
        }
      }
    }

    // 4. Update HyDE Embedding
    await profileService.generateAndSaveHydeProfile(userId, {
      userId,
      identity: {
        name: userProfile.identity?.name || userName || 'User',
        bio: userProfile.identity?.bio || '',
        location: userProfile.identity?.location || ''
      },
      narrative: userProfile.narrative || undefined,
      attributes: {
        interests: userProfile.attributes?.interests || [],
        skills: userProfile.attributes?.skills || [],
        goals: []
      }
    });

    log.info(`[ProfileWorker] Job ${job.id} completed successfully`);

  } catch (error) {
    log.error(`[ProfileWorker] Job ${job.id} failed:`, { error });
    throw error;
  }
}

export const profileWorker = QueueFactory.createWorker<ProfileUpdateJobData>(PROFILE_QUEUE_NAME, profileProcessor, {
  concurrency: 5,
  limiter: {
    max: 20,
    duration: 1000,
  },
});

export const addProfileUpdateJob = async (data: ProfileUpdateJobData) => {
  try {
    await profileQueue.add('profile-update', data, {
      attempts: 3,
      backoff: {
        type: 'exponential',
        delay: 5000,
      },
      removeOnComplete: true,
    });
    log.info(`[ProfileQueue] Added job for user ${data.userId}`);
  } catch (error) {
    log.error(`[ProfileQueue] Failed to add job for user ${data.userId}`, { error });
  }
};
