import { Controller, Get, Patch, UseGuards } from '../lib/router/router.decorators';
import { AuthGuard } from '../guards/auth.guard';
import type { AuthenticatedUser } from '../guards/auth.guard';
import { userService } from '../services/user.service';
import { profileService } from '../services/profile.service';
import { log } from '../lib/log';

const logger = log.controller.from('auth');

function hasAtLeastOneSocial(socials: unknown): boolean {
  if (!socials || typeof socials !== 'object') {
    return false;
  }

  const socialRecord = socials as {
    x?: string;
    linkedin?: string;
    github?: string;
    websites?: string[];
  };

  return Boolean(
    socialRecord.x ||
      socialRecord.linkedin ||
      socialRecord.github ||
      (Array.isArray(socialRecord.websites) && socialRecord.websites.length > 0)
  );
}

function shouldAutoGenerateProfile(user: {
  name?: string | null;
  socials?: unknown;
  profile?: unknown;
}): boolean {
  const hasName = typeof user.name === 'string' && user.name.trim().length > 0;
  return hasName && hasAtLeastOneSocial(user.socials) && !user.profile;
}

@Controller('/auth')
export class AuthController {
  /**
   * Returns the list of configured social auth providers (public, no auth required).
   */
  @Get('/providers')
  async providers() {
    const providers: string[] = [];
    if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
      providers.push('google');
    }
    return Response.json({ providers });
  }

  /**
   * Returns the current authenticated user.
   * Response shape: { user: User } for frontend APIResponse compatibility.
   */
  @Get('/me')
  @UseGuards(AuthGuard)
  async me(_req: Request, user: AuthenticatedUser) {
    logger.verbose('Auth me requested', { userId: user.id });
    const fullUser = await userService.findWithGraph(user.id);
    if (!fullUser) {
      return Response.json({ error: 'User not found' }, { status: 404 });
    }

    if (shouldAutoGenerateProfile(fullUser)) {
      logger.verbose('Auto-generating profile', { userId: user.id });
      profileService.syncProfile(user.id).catch((error) => {
        logger.error('Background profile sync failed', {
          userId: user.id,
          error: error instanceof Error ? error.message : String(error),
        });
      });
    }

    const { profile: _profile, notificationPreferences, ...userFields } = fullUser;
    return Response.json({
      user: {
        ...userFields,
        notificationPreferences,
      },
    });
  }

  /**
   * Updates the authenticated user's profile.
   * Response shape: { user: User } for frontend APIResponse compatibility.
   */
  @Patch('/profile/update')
  @UseGuards(AuthGuard)
  async updateProfile(req: Request, user: AuthenticatedUser) {
    const body = await req.json().catch(() => ({})) as { name?: string; intro?: string; avatar?: string; location?: string; timezone?: string; socials?: object; notificationPreferences?: { connectionUpdates?: boolean; weeklyNewsletter?: boolean } };
    const { notificationPreferences, ...userFields } = body;

    if (Object.keys(userFields).length > 0) {
      await userService.update(user.id, userFields);
    }
    if (notificationPreferences) {
      await userService.updateNotificationPreferences(user.id, notificationPreferences);
    }

    const fullUser = await userService.findWithGraph(user.id);
    if (!fullUser) {
      return Response.json({ error: 'User not found' }, { status: 404 });
    }
    const { profile: _profileOut, notificationPreferences: prefs, ...userFieldsOut } = fullUser;
    return Response.json({
      user: { ...userFieldsOut, notificationPreferences: prefs },
    });
  }
}
