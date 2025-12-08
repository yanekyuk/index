import { Router, Response, Request } from 'express';
import { privyClient } from '../lib/privy';
import { authenticatePrivy, AuthRequest } from '../middleware/auth';
import db from '../lib/db';
import { users, userNotificationSettings } from '../lib/schema';
import { eq, isNull } from 'drizzle-orm';
import { User, UpdateProfileRequest, OnboardingState } from '../types';
import { checkAndTriggerSocialSync, checkAndTriggerEnrichment } from '../lib/integrations/social-sync';
import { generateSummaryWithIntents, GenerateSummaryInput, SummaryStreamEvent } from '../lib/parallels';

const router = Router();

// Verify access token and get user info
router.get('/me', authenticatePrivy, async (req: AuthRequest, res: Response) => {
  try {
    const userResult = await db.select({
      user: users,
      settings: userNotificationSettings
    })
      .from(users)
      .leftJoin(userNotificationSettings, eq(users.id, userNotificationSettings.userId))
      .where(eq(users.id, req.user!.id))
      .limit(1);

    if (userResult.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    const { user, settings } = userResult[0];

    // Merge settings into user object for frontend compatibility
    const userWithPreferences = {
      ...user,
      notificationPreferences: settings?.preferences || {
        connectionUpdates: true,
        weeklyNewsletter: true,
      }
    };

    return res.json({ user: userWithPreferences });
  } catch (error) {
    console.error('Get user error:', error);
    return res.status(500).json({ error: 'Failed to get user info' });
  }
});

// Update user profile
router.patch('/profile', authenticatePrivy, async (req: AuthRequest, res: Response) => {
  try {
    const { name, intro, avatar, location, timezone, socials, notificationPreferences } = req.body;

    // Get old socials before update
    const currentUser = await db.select({ socials: users.socials })
      .from(users)
      .where(eq(users.id, req.user!.id))
      .limit(1);
    const oldSocials = currentUser[0]?.socials || null;

    // Update user fields
    const updatedUserResult = await db.update(users)
      .set({
        ...(name && { name }),
        ...(intro !== undefined && { intro }),
        ...(avatar && { avatar }),
        ...(location !== undefined && { location }),
        ...(timezone !== undefined && { timezone }),
        ...(socials !== undefined && { socials }),
        updatedAt: new Date()
      })
      .where(eq(users.id, req.user!.id))
      .returning();

    if (updatedUserResult.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Update notification preferences if provided
    let updatedPreferences = null;
    if (notificationPreferences !== undefined) {
      const existingSettings = await db.select()
        .from(userNotificationSettings)
        .where(eq(userNotificationSettings.userId, req.user!.id))
        .limit(1);

      if (existingSettings.length > 0) {
        const settings = await db.update(userNotificationSettings)
          .set({
            preferences: notificationPreferences,
            updatedAt: new Date()
          })
          .where(eq(userNotificationSettings.userId, req.user!.id))
          .returning();
        updatedPreferences = settings[0].preferences;
      } else {
        const settings = await db.insert(userNotificationSettings)
          .values({
            userId: req.user!.id,
            preferences: notificationPreferences
          })
          .returning();
        updatedPreferences = settings[0].preferences;
      }
    } else {
      // Fetch existing preferences if not updating
      const settings = await db.select()
        .from(userNotificationSettings)
        .where(eq(userNotificationSettings.userId, req.user!.id))
        .limit(1);
      updatedPreferences = settings[0]?.preferences || {
        connectionRequest: true,
        connectionAccepted: true,
        connectionRejected: true,
        weeklyNewsletter: true,
      };
    }

    // Trigger social sync if socials changed
    if (socials !== undefined) {
      checkAndTriggerSocialSync(req.user!.id, oldSocials, socials);
    }

    // Check enrichment eligibility if name or intro fields were updated
    if (name !== undefined || intro !== undefined) {
      checkAndTriggerEnrichment(req.user!.id);
    }

    const finalUser = {
      ...updatedUserResult[0],
      notificationPreferences: updatedPreferences
    };

    return res.json({ user: finalUser });
  } catch (error) {
    console.error('Update profile error:', error);
    return res.status(500).json({ error: 'Failed to update profile' });
  }
});

// Update onboarding state
router.patch('/onboarding-state', authenticatePrivy, async (req: AuthRequest, res: Response) => {
  try {
    const { completedAt, flow, currentStep, indexId, invitationCode } = req.body;

    // Get current onboarding state
    const currentUser = await db.select({
      onboarding: users.onboarding
    }).from(users)
      .where(eq(users.id, req.user!.id))
      .limit(1);

    if (currentUser.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Merge with existing onboarding state
    const currentOnboarding = (currentUser[0].onboarding || {}) as any;
    const updatedOnboarding = {
      ...currentOnboarding,
      ...(completedAt !== undefined && { completedAt }),
      ...(flow !== undefined && { flow }),
      ...(currentStep !== undefined && { currentStep }),
      ...(indexId !== undefined && { indexId }),
      ...(invitationCode !== undefined && { invitationCode }),
    };

    const updatedUser = await db.update(users)
      .set({
        onboarding: updatedOnboarding,
        updatedAt: new Date()
      })
      .where(eq(users.id, req.user!.id))
      .returning({
        id: users.id,
        privyId: users.privyId,
        name: users.name,
        intro: users.intro,
        avatar: users.avatar,
        location: users.location,
        socials: users.socials,
        onboarding: users.onboarding,
        createdAt: users.createdAt,
        updatedAt: users.updatedAt
      });

    if (updatedUser.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    return res.json({ user: updatedUser[0] });
  } catch (error) {
    console.error('Update onboarding state error:', error);
    return res.status(500).json({ error: 'Failed to update onboarding state' });
  }
});

// Get Privy user from their service (for debugging/admin)
router.get('/privy-user', authenticatePrivy, async (req: AuthRequest, res: Response) => {
  try {
    const privyUser = await privyClient.getUserById(req.user!.privyId);
    return res.json({ privyUser });
  } catch (error) {
    console.error('Get Privy user error:', error);
    return res.status(500).json({ error: 'Failed to get Privy user info' });
  }
});

// Delete user account
router.delete('/account', authenticatePrivy, async (req: AuthRequest, res: Response) => {
  try {
    await db.update(users)
      .set({ deletedAt: new Date() })
      .where(eq(users.id, req.user!.id));

    return res.json({ message: 'Account deleted successfully' });
  } catch (error) {
    console.error('Delete account error:', error);
    return res.status(500).json({ error: 'Failed to delete account' });
  }
});

// Generate summary with intro, location, and intents using Parallel AI (SSE)
router.post('/generate-summary', authenticatePrivy, async (req: AuthRequest, res: Response) => {
  try {
    // Set up SSE headers
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    // Get user data
    const userRecords = await db.select({
      name: users.name,
      email: users.email,
      socials: users.socials,
    })
      .from(users)
      .where(eq(users.id, req.user!.id))
      .limit(1);

    if (userRecords.length === 0) {
      res.write(`data: ${JSON.stringify({ type: 'error', message: 'User not found' })}\n\n`);
      res.end();
      return;
    }

    const user = userRecords[0];
    const socials = (user.socials || {}) as { x?: string; linkedin?: string };

    // Build input for Parallel
    const input: GenerateSummaryInput = {
      name: user.name || undefined,
      email: user.email || undefined,
    };

    // Convert LinkedIn username to URL if needed
    if (socials.linkedin) {
      const linkedinValue = String(socials.linkedin).trim();
      if (linkedinValue) {
        input.linkedin_url = linkedinValue.startsWith('http')
          ? linkedinValue
          : `https://www.linkedin.com/in/${linkedinValue}`;
      }
    }

    // Convert Twitter username to URL if needed
    if (socials.x) {
      const twitterValue = String(socials.x).trim();
      if (twitterValue) {
        if (twitterValue.startsWith('http')) {
          input.twitter_url = twitterValue;
        } else {
          const username = twitterValue.replace(/^@/, '');
          input.twitter_url = `https://x.com/${username}`;
        }
      }
    }

    // Stream events to client
    const sendEvent = (event: SummaryStreamEvent) => {
      res.write(`data: ${JSON.stringify(event)}\n\n`);
    };

    // Generate summary with streaming events
    await generateSummaryWithIntents(input, sendEvent);

    // End the stream
    res.write(`data: ${JSON.stringify({ type: 'done' })}\n\n`);
    res.end();
  } catch (error) {
    console.error('Generate summary error:', error);
    try {
      res.write(`data: ${JSON.stringify({ type: 'error', message: 'Failed to generate summary' })}\n\n`);
      res.end();
    } catch {
      // Response already ended
    }
  }
});

export default router; 