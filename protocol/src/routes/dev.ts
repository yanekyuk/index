import { Router, Request, Response } from 'express';
import { sendWeeklyNewsletter } from '../jobs/newsletter.job';
import { addJob as addOpportunityJob } from '../queues/opportunity.queue';
import { addJob as addProfileJob } from '../queues/profile.queue';
import { cache } from '../lib/redis';
import { profileService } from '../services/profile.service';
import { intentService } from '../services/intent.service';
import { log } from '../lib/log';

const router = Router();

// Middleware to ensure this is only available in development
router.use((req, res, next) => {
    if (process.env.NODE_ENV !== 'development') {
        return res.status(404).json({ error: 'Not found' });
    }
    return next();
});

router.post('/newsletter/trigger', async (req: Request, res: Response) => {
    console.time('ManualNewsletterTrigger');
    try {
        const { date } = req.body;
        const now = date ? new Date(date) : new Date();

        console.log(`Manually triggering weekly newsletter with date: ${now.toISOString()}`);

        await sendWeeklyNewsletter(now, true, 1);

        console.timeEnd('ManualNewsletterTrigger');
        res.json({ message: 'Weekly newsletter job completed' });
    } catch (error) {
        console.error('Error triggering newsletter:', error);
        console.timeEnd('ManualNewsletterTrigger');
        res.status(500).json({ error: 'Failed to trigger newsletter' });
    }
});

router.post('/opportunity-finder/trigger', async (req: Request, res: Response) => {
    try {
        console.log('Manually triggering Opportunity Finder Cycle via Queue');
        await addOpportunityJob('process_opportunities', {
            timestamp: Date.now(),
            force: true
        });
        res.json({ message: 'Opportunity Finder Cycle job added to queue.' });
    } catch (error) {
        console.error('Error triggering Opportunity Finder:', error);
        res.status(500).json({ error: 'Failed to trigger Opportunity Finder cycle' });
    }
});

router.post('/reset-matches', async (req: Request, res: Response) => {
    try {
        console.log('Manually checking and clearing Redis cache for matches (synthesis)...');

        // Clear the 'synthesis' hash in Redis where descriptions are cached
        await cache.del('synthesis');

        console.log('✅ Redis cache for matches cleared.');
        res.json({ message: 'Redis cache for matches (synthesis) cleared successfully.' });
    } catch (error) {
        console.error('Error resetting matches cache:', error);
        res.status(500).json({ error: 'Failed to reset matches cache' });
    }
});

/**
 * Generate missing profiles endpoint.
 *
 * Finds all users without profiles and queues profile generation jobs for them.
 * This uses the existing profile queue infrastructure to:
 * 1. Create initial profile entries
 * 2. Repair/enhance profiles using AI
 * 3. Run opportunity finder for each user
 */
router.post('/generate-missing-profiles', async (req: Request, res: Response) => {
    try {
        log.info('[Dev] Triggering profile generation for users without profiles');
        
        // Get all users without profiles
        const usersWithoutProfiles = await profileService.getUsersWithoutProfiles();
        
        if (usersWithoutProfiles.length === 0) {
            log.info('[Dev] No users without profiles found');
            return res.json({
                message: 'No users without profiles found',
                queued: 0
            });
        }
        
        log.info(`[Dev] Found ${usersWithoutProfiles.length} users without profiles`);
        
        let queued = 0;
        const errors: string[] = [];
        
        for (const user of usersWithoutProfiles) {
            try {
                // Create initial profile entry so the queue job can repair it
                await profileService.createInitialProfile(
                    user.id,
                    user.name,
                    user.intro,
                    user.location
                );
                
                // Queue profile update job to repair/enhance the profile
                await addProfileJob('profile-update', {
                    userId: user.id,
                    intro: user.intro || '',
                    userName: user.name
                });
                
                queued++;
                log.info(`[Dev] Queued profile generation for user ${user.id} (${user.name})`);
            } catch (error) {
                const errorMsg = `Failed to queue profile for user ${user.id}: ${error instanceof Error ? error.message : String(error)}`;
                log.error(`[Dev] ${errorMsg}`);
                errors.push(errorMsg);
            }
        }
        
        const response: {
            message: string;
            queued: number;
            total: number;
            errors?: string[];
        } = {
            message: `Queued profile generation for ${queued} out of ${usersWithoutProfiles.length} users`,
            queued,
            total: usersWithoutProfiles.length
        };
        
        if (errors.length > 0) {
            response.errors = errors;
        }
        
        log.info(`[Dev] Profile generation queuing complete: ${queued}/${usersWithoutProfiles.length}`);
        return res.json(response);
        
    } catch (error) {
        log.error('[Dev] Error generating missing profiles:', { error });
        return res.status(500).json({ error: 'Failed to generate missing profiles' });
    }
});

/**
 * Delete all intents endpoint.
 *
 * WARNING: This is a destructive operation that removes ALL intents and related data.
 * Only available in development environment.
 */
router.delete('/delete-all-intents', async (req: Request, res: Response) => {
    try {
        log.info('[Dev] Triggering deletion of all intents');

        const result = await intentService.deleteAllIntents();

        log.info('[Dev] All intents deleted successfully', result);
        return res.json({
            message: 'All intents and related data deleted successfully',
            deleted: result
        });
    } catch (error) {
        log.error('[Dev] Error deleting all intents:', { error });
        return res.status(500).json({ error: 'Failed to delete all intents' });
    }
});

export default router;
