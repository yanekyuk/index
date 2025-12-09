import { Router, Request, Response } from 'express';
import { sendWeeklyNewsletter } from '../jobs/weekly-newsletter';

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

export default router;
