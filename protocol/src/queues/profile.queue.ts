import { Job } from 'bullmq';
import { QueueFactory } from '../lib/bullmq/bullmq';
import { log } from '../lib/log';
import { profileService } from '../services/profile.service';
import { opportunityService } from '../services/opportunity.service';

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
 * 2. Run full Opportunity Finder cycle (intents + stakes)
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

    // 2. Run Full Opportunity Finder for this user
    // This finds matching candidates, creates intents for BOTH users, and creates stakes
    log.info(`[ProfileWorker] Running Opportunity Finder for user ${userId}...`);
    await opportunityService.runOpportunityFinderForUser(userId);

    // 3. Update HyDE Embedding (may already be done by opportunity finder, but ensure it's saved)
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
export const queueEvents = QueueFactory.createQueueEvents(PROFILE_QUEUE_NAME);

/**
 * Add a job to the Profile Queue.
 *
 * @param name - The name of the job ('profile-update').
 * @param data - The payload for the job.
 * @param priority - Optional priority level (higher number = higher priority).
 * @returns The created Job instance.
 */
export const addJob = async (
  name: string,
  data: ProfileUpdateJobData,
  priority: number = 0
) => {
  try {
    return await profileQueue.add(name, data, {
      priority: priority > 0 ? priority : undefined,
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
    // In strict addJob signature, we should return Promise<Job>. But original code swallowed error and logged it.
    // The template says "returns The created Job instance".
    // I should probably let it throw or handle it properly.
    // However, existing callers might expect void or catch bugs.
    // Original addProfileUpdateJob returned Promise<void>.
    // To be standards compliant I should return the job and throw on error, but I need to check callers.
    // Let's return the job and throw if it fails, which is standard. Callers should handle errors or I can wrap in try catch in caller.
    throw error;
  }
};
