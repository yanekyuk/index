import { Controller, Get, UseGuards } from '../lib/router/router.decorators';
import { AuthGuard } from '../guards/auth.guard';
import type { AuthenticatedUser } from '../guards/auth.guard';
import { userService } from '../services/user.service';
import { log } from '../lib/log';

const logger = log.controller.from('user');

@Controller('/users')
export class UserController {
  @Get('/:userId')
  @UseGuards(AuthGuard)
  async getUser(_req: Request, _user: AuthenticatedUser, params: { userId: string }) {
    logger.info('Get user requested', { userId: params.userId });
    const user = await userService.findById(params.userId);
    if (!user) {
      return Response.json({ error: 'User not found' }, { status: 404 });
    }
    return Response.json({
      user: {
        id: user.id,
        name: user.name,
        intro: user.intro,
        avatar: user.avatar,
        location: user.location,
        socials: user.socials,
        createdAt: user.createdAt,
        updatedAt: user.updatedAt,
      },
    });
  }
}
