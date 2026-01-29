import { eq } from 'drizzle-orm';
import * as schema from '../lib/schema';
import db from '../lib/db';
import { IndexEmbedder } from '../lib/embedder';
import { ProfileGraphFactory } from '../lib/protocol/graphs/profile/profile.graph';
import { Database } from '../lib/protocol/interfaces/database.interface';
import { Scraper } from '../lib/protocol/interfaces/scraper.interface';
import { Embedder } from '../lib/protocol/interfaces/embedder.interface';
import { ProfileDocument } from '../lib/protocol/agents/profile/profile.generator';
import { User } from '../lib/schema';

// --- Adapters ---

import { searchUser } from '../lib/parallel/parallel';

export class DrizzleDatabaseAdapter implements Database {

  async getProfile(userId: string): Promise<ProfileDocument | null> {
    const result = await db.select()
      .from(schema.userProfiles)
      .where(eq(schema.userProfiles.userId, userId))
      .limit(1);

    // Casting to ProfileDocument - assuming schema matches Agent output structure
    // We ignore hydeDescription/hydeEmbedding for this specific return type as strictly defined by ProfileDocument
    // or we accept that userProfiles row has more fields.
    return (result[0] as unknown as ProfileDocument) || null;
  }

  async saveProfile(userId: string, profile: ProfileDocument): Promise<void> {
    const data = {
      userId,
      identity: profile.identity,
      narrative: profile.narrative,
      attributes: profile.attributes,
      embedding: Array.isArray(profile.embedding[0]) ? (profile.embedding as number[][])[0] : (profile.embedding as number[]),
      updatedAt: new Date()
    };

    await db.insert(schema.userProfiles)
      .values(data)
      .onConflictDoUpdate({
        target: schema.userProfiles.userId,
        set: data
      });
  }

  async saveHydeProfile(userId: string, description: string, embedding: number[]): Promise<void> {
    await db.update(schema.userProfiles)
      .set({
        hydeDescription: description,
        hydeEmbedding: embedding,
        updatedAt: new Date()
      })
      .where(eq(schema.userProfiles.userId, userId));
  }

  async getUser(userId: string): Promise<User | null> {
    const result = await db.select()
      .from(schema.users)
      .where(eq(schema.users.id, userId))
      .limit(1);

    return result[0] || null;
  }
}

export class ParallelScraperAdapter implements Scraper {
  async scrape(objective: string): Promise<string> {
    try {
      const response = await searchUser({ objective });

      const formattedResults = response.results.map(r => {
        return `Title: ${r.title}\nURL: ${r.url}\nExcerpts:\n${r.excerpts.join('\n')}`;
      }).join('\n\n');

      if (!formattedResults) {
        return `No information found for objective: ${objective}`;
      }

      return `Objective: ${objective}\n\nSearch Results:\n${formattedResults}`;
    } catch (error: any) {
      console.error("ParallelScraperAdapter error:", error);
      // Fallback: return objective so the flow continues, albeit with less info
      return `Objective: ${objective}\n\n(Search failed: ${error.message})`;
    }
  }
}

// --- Controller ---
import { Controller, Post, UseGuards } from '../lib/router/router.decorators';
import { AuthGuard } from '../guards/auth.guard';
import type { AuthenticatedUser } from '../guards/auth.guard';

@Controller('/profiles')
export class ProfileController {
  private db: Database;
  private embedder: Embedder;
  private scraper: Scraper;
  private factory: ProfileGraphFactory;

  constructor() {
    this.db = new DrizzleDatabaseAdapter();
    // IndexEmbedder (from ../lib/embedder) implements Embedder interface
    this.embedder = new IndexEmbedder();
    this.scraper = new ParallelScraperAdapter();
    this.factory = new ProfileGraphFactory(this.db, this.embedder, this.scraper);
  }

  /**
   * Syncs/Generates a profile for the given user.
   * This is the main entry point to trigger the profile graph.
   */
  @Post('/sync')
  @UseGuards(AuthGuard)
  async sync(req: Request, user: AuthenticatedUser) {
    const graph = this.factory.createGraph();

    // Invoke the graph
    // The graph expects { userId } in the state.
    const result = await graph.invoke({ userId: user.id });

    return Response.json(result);
  }
}
