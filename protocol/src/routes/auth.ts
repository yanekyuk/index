import { Router, Response } from 'express';
import { authenticatePrivy, AuthRequest } from '../middleware/auth';
import { AuthService } from '../services/auth.service';
import { ProfileService } from '../services/profile.service';
import { UserService } from '../services/user.service';
import { OnboardingState } from '../schemas/database.schema';
import { addJob } from '../queues/profile.queue';

const router = Router();
const userService = new UserService();
const authService = new AuthService();
const profileService = new ProfileService();

// Verify access token and get user info
router.get('/me', authenticatePrivy, async (req: AuthRequest, res: Response) => {
  try {
    const user = await userService.findWithGraph(req.user!.id);

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    return res.json({ user });
  } catch (error) {
    console.error('Get user error:', error);
    return res.status(500).json({ error: 'Failed to get user info' });
  }
});

// Update user profile
router.patch('/profile/update', authenticatePrivy, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.id;
    const { name, avatar, location, timezone, socials, ...profileData } = req.body;

    // 1. Get current user (for old socials comparison)
    const currentUser = await userService.findById(userId);
    if (!currentUser) {
      return res.status(404).json({ error: 'User not found' });
    }

    // 2. Update user table fields via UserService
    const updatedUser = await userService.update(userId, {
      ...(name && { name }),
      ...(avatar && { avatar }),
      ...(location !== undefined && { location }),
      ...(timezone !== undefined && { timezone }),
      ...(socials !== undefined && { socials }),
    });

    if (!updatedUser) {
      return res.status(404).json({ error: 'User update failed' });
    }

    // 3. Update profile specific data via ProfileService
    const result = await profileService.updateProfile(
      userId,
      {
        name,
        avatar,
        location,
        timezone,
        socials,
        ...profileData
      },
      updatedUser,
      currentUser
    );

    return res.json({ user: result });
  } catch (error) {
    console.error('Update profile error:', error);
    return res.status(500).json({ error: 'Failed to update profile' });
  }
});

// Update onboarding state
router.patch('/onboarding-state', authenticatePrivy, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.id;
    const data = req.body;

    // 1. Get current user
    const currentUser = await userService.findById(userId);
    if (!currentUser) {
      return res.status(404).json({ error: 'User not found' });
    }

    // 2. Calculate new state
    const currentOnboarding = (currentUser.onboarding || {}) as OnboardingState;
    const updatedOnboarding = authService.calculateOnboardingState(currentOnboarding, data);

    // 3. Update user
    const updatedUser = await userService.update(userId, {
      onboarding: updatedOnboarding
    });

    if (!updatedUser) {
      return res.status(500).json({ error: 'Failed to update user' });
    }

    // 4. Trigger side effects
    if (data.completedAt) {
      await authService.setupDefaultPreferences(userId);

      // Trigger background processing (Intents, HyDE, Repair validation)
      // Now safe to trigger as user should have joined the index
      addJob('profile-update', {
        userId: userId,
        intro: currentUser.intro || '',
        userName: currentUser.name
      }).catch(err => console.error('Failed to queue profile update at onboarding complete:', err));
    }

    return res.json({ user: updatedUser });
  } catch (error) {
    console.error('Update onboarding state error:', error);
    return res.status(500).json({ error: 'Failed to update onboarding state' });
  }
});

// Get Privy user from their service (for debugging/admin)
router.get('/privy-user', authenticatePrivy, async (req: AuthRequest, res: Response) => {
  try {
    // 1. Get user to get the privyId (although it might be in token, let's be safe and consistent)
    const user = await userService.findById(req.user!.id);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // 2. Call AuthService
    const privyUser = await authService.getPrivyUser(user.privyId);
    return res.json({ privyUser });
  } catch (error) {
    console.error('Get Privy user error:', error);
    return res.status(500).json({ error: 'Failed to get Privy user info' });
  }
});

// Delete user account
router.delete('/account', authenticatePrivy, async (req: AuthRequest, res: Response) => {
  try {
    await userService.softDelete(req.user!.id);
    return res.json({ message: 'Account deleted successfully' });
  } catch (error) {
    console.error('Delete account error:', error);
    return res.status(500).json({ error: 'Failed to delete account' });
  }
});

// Generate profile with intro, location, etc. using Parallel AI (SSE)
router.post('/profile/generate', authenticatePrivy, async (req: AuthRequest, res: Response) => {
  try {
    // Set up SSE headers
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    // 1. Get user
    const user = await userService.findById(req.user!.id);
    if (!user) {
      res.write(`data: ${JSON.stringify({ type: 'error', message: 'User not found' })}\n\n`);
      res.end();
      return;
    }

    // 2. Call ProfileService
    await profileService.generateProfile(user, {
      onStatus: (message) => {
        res.write(`data: ${JSON.stringify({ type: 'status', message })}\n\n`);
      },
      onResult: (data) => {
        // Trigger background processing (Intents, HyDE, Repair validation)
        // Safe to trigger immediately thanks to Dynamic Scoping (Intents become visible once User joins Index)
        try {
          addJob('profile-update', {
            userId: user.id,
            intro: data.intro,
            userName: user.name
          }).catch(err => console.error('Failed to queue profile update:', err));
        } catch (err) {
          console.error('Failed to initiate profile update job (sync error):', err);
        }

        res.write(`data: ${JSON.stringify({
          type: 'result',
          data
        })}\n\n`);
        res.write(`data: ${JSON.stringify({ type: 'done' })}\n\n`);
        res.end();
      },
      onError: (message) => {
        res.write(`data: ${JSON.stringify({ type: 'error', message })}\n\n`);
        res.end();
      }
    });
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