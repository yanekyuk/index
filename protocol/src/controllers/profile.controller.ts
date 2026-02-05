import { EmbedderAdapter } from '../adapters/embedder.adapter';
import { ProfileGraphFactory } from '../lib/protocol/graphs/profile/profile.graph';
import type { ProfileGraphDatabase } from '../lib/protocol/interfaces/database.interface';
import type { Scraper } from '../lib/protocol/interfaces/scraper.interface';
import type { Embedder } from '../lib/protocol/interfaces/embedder.interface';
import { ProfileDatabaseAdapter } from '../adapters/database.adapter';
import { ScraperAdapter } from '../adapters/scraper.adapter';
import { Controller, Post, UseGuards } from '../lib/router/router.decorators';
import { AuthGuard } from '../guards/auth.guard';
import type { AuthenticatedUser } from '../guards/auth.guard';
import { log } from '../lib/log';

const logger = log.controller.from('profile');

@Controller('/profiles')
export class ProfileController {
  private db: ProfileGraphDatabase;
  private embedder: Embedder;
  private scraper: Scraper;
  private factory: ProfileGraphFactory;

  constructor() {
    this.db = new ProfileDatabaseAdapter();
    this.embedder = new EmbedderAdapter();
    this.scraper = new ScraperAdapter();
    this.factory = new ProfileGraphFactory(this.db, this.embedder, this.scraper);
  }

  /**
   * Syncs/Generates a profile for the given user.
   * This is the main entry point to trigger the profile graph.
   */
  @Post('/sync')
  @UseGuards(AuthGuard)
  async sync(req: Request, user: AuthenticatedUser) {
    logger.info('Profile sync requested', { userId: user.id });
    const graph = this.factory.createGraph();

    // Invoke the graph
    // The graph expects { userId } in the state.
    const result = await graph.invoke({ userId: user.id });

    return Response.json(result);
  }
}
