import { Controller, Get, Patch, UseGuards } from '../lib/router/router.decorators';
import { AuthGuard } from '../guards/auth.guard';
import type { AuthenticatedUser } from '../guards/auth.guard';
import { userService } from '../services/user.service';
import { log } from '../lib/log';

const logger = log.controller.from('auth');

@Controller('/auth')
export class AuthController {
  /**
   * Returns the current authenticated user.
   * Response shape: { user: User } for frontend APIResponse compatibility.
   */
  @Get('/me')
  @UseGuards(AuthGuard)
  async me(_req: Request, user: AuthenticatedUser) {
    logger.info('Auth me requested', { userId: user.id });
    const fullUser = await userService.findWithGraph(user.id);
    if (!fullUser) {
      return Response.json({ error: 'User not found' }, { status: 404 });
    }
    const { profile, notificationPreferences, ...userFields } = fullUser;
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
    const { profile, notificationPreferences: prefs, ...userFieldsOut } = fullUser;
    return Response.json({
      user: { ...userFieldsOut, notificationPreferences: prefs },
    });
  }
}
