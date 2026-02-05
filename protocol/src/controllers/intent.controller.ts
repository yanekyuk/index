import { eq } from 'drizzle-orm';
import * as schema from '../schemas/database.schema';
import db from '../lib/drizzle/drizzle';
import type { IntentGraphDatabase } from '../lib/protocol/interfaces/database.interface';
import { IntentGraphFactory } from '../lib/protocol/graphs/intent/intent.graph';
import { IntentDatabaseAdapter } from '../adapters/database.adapter';

import { Controller, Post, UseGuards } from '../lib/router/router.decorators';
import { AuthGuard } from '../guards/auth.guard';
import type { AuthenticatedUser } from '../guards/auth.guard';
import { log } from '../lib/log';

const logger = log.controller.from('intent');

@Controller('/intents')
export class IntentController {
  private db: IntentGraphDatabase;
  private factory: IntentGraphFactory;

  constructor() {
    this.db = new IntentDatabaseAdapter();
    this.factory = new IntentGraphFactory(this.db);
  }

  /**
   * Processes user input through the Intent Graph.
   * Extracts, verifies, reconciles, and executes intent actions.
   * 
   * @param req - The HTTP request object (body: { content?: string })
   * @param user - The authenticated user from AuthGuard
   * @returns JSON response with graph execution result
   */
  @Post('/process')
  @UseGuards(AuthGuard)
  async process(req: Request, user: AuthenticatedUser) {
    logger.info('Intent process requested', { userId: user.id });
    // 1. Parse request body for content
    let content: string | undefined;
    try {
      const body = await req.json() as { content?: string };
      content = body.content;
    } catch {
      // No body or invalid JSON - content remains undefined
    }

    // 2. Fetch user profile
    const profile = await db.select()
      .from(schema.userProfiles)
      .where(eq(schema.userProfiles.userId, user.id))
      .limit(1);

    const userProfile = profile[0] ? JSON.stringify(profile[0]) : '{}';

    // 3. Create graph and invoke
    const graph = this.factory.createGraph();
    const result = await graph.invoke(
      {
        userId: user.id,
        userProfile: userProfile,
        inputContent: content,
      },
      { recursionLimit: 100 }
    );

    // 4. Return result
    return Response.json(result);
  }
}
