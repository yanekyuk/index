import { AuthGuard, type AuthenticatedUser } from '../guards/auth.guard';
import { log } from '../lib/log';
import { Controller, Get, UseGuards } from '../lib/router/router.decorators';
import { indexService } from '../services/index.service';

const logger = log.controller.from('index');

@Controller('/indexes')
export class IndexController {
  /**
   * List indexes the authenticated user is a member of, including their personal index.
   * Response shape matches Express GET /api/indexes for frontend compatibility.
   * "Everywhere" is not returned; it is a static UI option.
   *
   * @param _req - The HTTP request object (unused)
   * @param user - The authenticated user from AuthGuard
   * @returns JSON response with { indexes, pagination }
   */
  @Get('')
  @UseGuards(AuthGuard)
  async list(_req: Request, user: AuthenticatedUser) {
    const result = await indexService.getIndexesForUser(user.id);
    logger.info('Indexes listed for user', { userId: user.id, count: result.indexes.length });
    return Response.json(result);
  }
}
