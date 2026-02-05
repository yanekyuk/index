import express from 'express';
import db from '../lib/drizzle/drizzle';
import { userNotificationSettings, users } from '../schemas/database.schema';
import { eq } from 'drizzle-orm';

const router = express.Router();

// Helper function to handle unsubscription
async function handleUnsubscribe(token: string, type?: string) {
    if (!token || typeof token !== 'string') {
        throw new Error('Invalid token');
    }

    // Fetch settings first
    const settings = await db.select()
        .from(userNotificationSettings)
        .where(eq(userNotificationSettings.unsubscribeToken, token))
        .limit(1);

    if (settings.length === 0) {
        throw new Error('Subscription not found');
    }

    let currentPreferences = settings[0].preferences;

    // Robust fallback: if null, undefined, or empty object, use defaults
    if (!currentPreferences || Object.keys(currentPreferences).length === 0) {
        currentPreferences = {
            connectionUpdates: true,
            weeklyNewsletter: true,
        };
    } else {
        // Ensure keys exist (migration/backfill logic on read)
        if (currentPreferences.connectionUpdates === undefined) currentPreferences.connectionUpdates = true;
        if (currentPreferences.weeklyNewsletter === undefined) currentPreferences.weeklyNewsletter = true;
    }

    let newPreferences = { ...currentPreferences };
    let message = '';

    if (type === 'weeklyNewsletter') {
        newPreferences.weeklyNewsletter = false;
        message = 'You have been unsubscribed from our weekly newsletter.';
    } else if (type === 'connectionUpdates') {
        newPreferences.connectionUpdates = false;
        message = 'You have been unsubscribed from connection updates.';
    } else {
        // Unsubscribe from everything if no type specified or 'all'
        newPreferences.weeklyNewsletter = false;
        newPreferences.connectionUpdates = false;
        message = 'You have been unsubscribed from all emails.';
    }

    await db.update(userNotificationSettings)
        .set({ preferences: newPreferences })
        .where(eq(userNotificationSettings.id, settings[0].id));

    return message;
}

router.get('/unsubscribe', async (req, res) => {
    const { token, type } = req.query;

    try {
        const message = await handleUnsubscribe(token as string, type as string);

        res.send(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Unsubscribed</title>
        <style>
          body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0; background-color: #f5f5f5; }
          .container { background: white; padding: 2rem; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); text-align: center; max-width: 400px; }
          h1 { color: #333; margin-top: 0; }
          p { color: #666; line-height: 1.5; }
        </style>
      </head>
      <body>
        <div class="container">
          <h1>Unsubscribed</h1>
          <p>${message}</p>
          <p>You can close this window now.</p>
        </div>
      </body>
      </html>
    `);

    } catch (error: any) {
        console.error('Unsubscribe error:', error);
        if (error.message === 'Invalid token') {
            res.status(400).send('Invalid token');
            return;
        }
        if (error.message === 'Subscription not found') {
            res.status(404).send('Subscription not found');
            return;
        }
        res.status(500).send('An error occurred');
    }
});

router.post('/unsubscribe', async (req, res) => {
    const { token, type } = req.query; // RFC 8058 passes unsubscribe params in the POST URL as well (from the Link header)

    // Also support body params if sent that way
    const tokenParam = (token || req.body.token) as string;
    const typeParam = (type || req.body.type) as string;

    try {
        await handleUnsubscribe(tokenParam, typeParam);
        res.status(200).send('Unsubscribed successfully');
    } catch (error: any) {
        console.error('Unsubscribe POST error:', error);
        if (error.message === 'Invalid token') {
            res.status(400).send('Invalid token');
            return;
        }
        if (error.message === 'Subscription not found') {
            res.status(404).send('Subscription not found');
            return;
        }
        res.status(500).send('An error occurred');
    }
});

export default router;
