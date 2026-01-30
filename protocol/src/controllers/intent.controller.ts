import { eq, isNull, and } from 'drizzle-orm';
import * as schema from '../lib/schema';
import db from '../lib/db';
import {
  IntentGraphDatabase,
  ActiveIntent,
  CreateIntentData,
  UpdateIntentData,
  CreatedIntent,
  ArchiveResult
} from '../lib/protocol/interfaces/database.interface';
import { IntentGraphFactory } from '../lib/protocol/graphs/intent/intent.graph';

// --- Adapters ---

/**
 * Database adapter implementing IntentGraphDatabase interface.
 * Provides intent CRUD operations for the Intent Graph.
 */
export class IntentDatabaseAdapter implements IntentGraphDatabase {

  /**
   * Retrieves all active (non-archived) intents for a user.
   * @param userId - The unique identifier of the user
   * @returns Array of active intents with minimal fields needed for reconciliation
   */
  async getActiveIntents(userId: string): Promise<ActiveIntent[]> {
    try {
      const result = await db.select({
        id: schema.intents.id,
        payload: schema.intents.payload,
        summary: schema.intents.summary,
        createdAt: schema.intents.createdAt,
      })
        .from(schema.intents)
        .where(
          and(
            eq(schema.intents.userId, userId),
            isNull(schema.intents.archivedAt)
          )
        );

      return result;
    } catch (error: any) {
      console.error("IntentDatabaseAdapter.getActiveIntents error:", error);
      return [];
    }
  }

  /**
   * Creates a new intent with the provided data.
   * @param data - The intent creation data
   * @returns The created intent
   */
  async createIntent(data: CreateIntentData): Promise<CreatedIntent> {
    try {
      const [created] = await db.insert(schema.intents)
        .values({
          userId: data.userId,
          payload: data.payload,
          summary: data.summary ?? null,
          embedding: data.embedding,
          isIncognito: data.isIncognito ?? false,
          sourceType: data.sourceType,
          sourceId: data.sourceId,
        })
        .returning({
          id: schema.intents.id,
          payload: schema.intents.payload,
          summary: schema.intents.summary,
          isIncognito: schema.intents.isIncognito,
          createdAt: schema.intents.createdAt,
          updatedAt: schema.intents.updatedAt,
          userId: schema.intents.userId,
        });

      return created;
    } catch (error: any) {
      console.error("IntentDatabaseAdapter.createIntent error:", error);
      throw error;
    }
  }

  /**
   * Updates an existing intent.
   * @param intentId - The unique identifier of the intent to update
   * @param data - The fields to update
   * @returns The updated intent or null if not found
   */
  async updateIntent(intentId: string, data: UpdateIntentData): Promise<CreatedIntent | null> {
    try {
      const updateData: Record<string, any> = {
        updatedAt: new Date(),
      };

      if (data.payload !== undefined) {
        updateData.payload = data.payload;
      }
      if (data.summary !== undefined) {
        updateData.summary = data.summary;
      }
      if (data.embedding !== undefined) {
        updateData.embedding = data.embedding;
      }
      if (data.isIncognito !== undefined) {
        updateData.isIncognito = data.isIncognito;
      }

      const [updated] = await db.update(schema.intents)
        .set(updateData)
        .where(eq(schema.intents.id, intentId))
        .returning({
          id: schema.intents.id,
          payload: schema.intents.payload,
          summary: schema.intents.summary,
          isIncognito: schema.intents.isIncognito,
          createdAt: schema.intents.createdAt,
          updatedAt: schema.intents.updatedAt,
          userId: schema.intents.userId,
        });

      return updated || null;
    } catch (error: any) {
      console.error("IntentDatabaseAdapter.updateIntent error:", error);
      return null;
    }
  }

  /**
   * Archives (soft-deletes) an intent by setting archivedAt timestamp.
   * @param intentId - The unique identifier of the intent to archive
   * @returns Result object indicating success or failure
   */
  async archiveIntent(intentId: string): Promise<ArchiveResult> {
    try {
      const [archived] = await db.update(schema.intents)
        .set({
          archivedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(schema.intents.id, intentId))
        .returning({ id: schema.intents.id });

      if (!archived) {
        return { success: false, error: 'Intent not found' };
      }

      return { success: true };
    } catch (error: any) {
      console.error("IntentDatabaseAdapter.archiveIntent error:", error);
      return { success: false, error: error.message || 'Unknown error' };
    }
  }
}

// --- Controller ---

import { Controller, Post, UseGuards } from '../lib/router/router.decorators';
import { AuthGuard } from '../guards/auth.guard';
import type { AuthenticatedUser } from '../guards/auth.guard';

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
