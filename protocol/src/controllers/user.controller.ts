import { z } from 'zod';

import { Controller, Get, Post, UseGuards } from '../lib/router/router.decorators';
import { AuthGuard } from '../guards/auth.guard';
import type { AuthenticatedUser } from '../guards/auth.guard';
import { userService } from '../services/user.service';
import { contactService } from '../services/contact.service';
import { log } from '../lib/log';

const logger = log.controller.from('user');

const AddContactBodySchema = z.object({
  email: z.string().trim().email(),
  name: z.string().trim().min(1).optional(),
});

const BATCH_MAX_IDS = 100;

@Controller('/users')
export class UserController {
  @Get('/batch')
  @UseGuards(AuthGuard)
  async getBatch(req: Request, _user: AuthenticatedUser) {
    const url = new URL(req.url);
    const idsParam = url.searchParams.get('ids') ?? '';
    const ids = idsParam
      .split(',')
      .map((id) => id.trim())
      .filter(Boolean);
    const uniqueIds = [...new Set(ids)].slice(0, BATCH_MAX_IDS);
    if (uniqueIds.length === 0) {
      return Response.json({ users: [] });
    }
    logger.verbose('Batch get users requested', { count: uniqueIds.length });
    const rows = await userService.findByIds(uniqueIds);
    const users = rows.map((row) => ({
      id: row.id,
      name: row.name,
      intro: row.intro,
      avatar: row.avatar,
      location: row.location,
      socials: row.socials,
      isGhost: row.isGhost,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    }));
    return Response.json({ users });
  }

  /**
   * POST /users/contacts — manually add a contact by email (creates ghost user if not registered).
   * @param req - Request with JSON body `{ email: string; name?: string }`
   * @param user - Authenticated user from AuthGuard
   * @returns JSON `{ result }` with the import outcome, or 400 if email is invalid
   */
  @Post('/contacts')
  @UseGuards(AuthGuard)
  async addContact(req: Request, user: AuthenticatedUser) {
    const parsed = AddContactBodySchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return Response.json({ error: 'A valid email is required' }, { status: 400 });
    }
    logger.verbose('Add contact requested', { userId: user.id });
    const result = await contactService.addContact(user.id, parsed.data.email, { name: parsed.data.name });
    return Response.json({ result });
  }

  @Get('/:userId')
  @UseGuards(AuthGuard)
  async getUser(_req: Request, _user: AuthenticatedUser, params: { userId: string }) {
    logger.verbose('Get user requested', { userId: params.userId });
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
        isGhost: user.isGhost,
        createdAt: user.createdAt,
        updatedAt: user.updatedAt,
      },
    });
  }
}
