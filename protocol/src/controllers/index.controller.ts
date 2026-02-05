/**
 * Index controller for V2 API.
 * GET /v2/indexes returns indexes the user is a member of plus their personal index.
 * "Everywhere" is a static UI option and is not returned by this endpoint.
 *
 * Uses protocol database interface and ChatDatabaseAdapter; no drizzle in this file.
 */

import { ChatDatabaseAdapter } from '../adapters/database.adapter';
import { Controller, Get, UseGuards } from '../lib/router/router.decorators';
import { AuthGuard } from '../guards/auth.guard';
import type { AuthenticatedUser } from '../guards/auth.guard';
import { log } from '../lib/log';

const logger = log.controller.from('index');

@Controller('/indexes')
export class IndexController {
  private db: ChatDatabaseAdapter;

  constructor() {
    this.db = new ChatDatabaseAdapter();
  }

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
    const result = await this.db.getIndexesForUser(user.id);
    logger.info('Indexes listed for user', { userId: user.id, count: result.indexes.length });
    return Response.json(result);
  }
}
