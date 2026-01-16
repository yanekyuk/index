import { Router, Request, Response } from 'express';
import { sendWeeklyNewsletter } from '../jobs/newsletter.job';
import { addJob } from '../queues/opportunity.queue';
import { cache } from '../lib/redis';

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
        await addJob('process_opportunities', {
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
export default router;
