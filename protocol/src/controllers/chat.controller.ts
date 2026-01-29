import { eq, isNull, and } from 'drizzle-orm';
import * as schema from '../lib/schema';
import db from '../lib/db';
import { HumanMessage } from '@langchain/core/messages';
import { IndexEmbedder } from '../lib/embedder';
import { ChatGraphFactory } from '../lib/protocol/graphs/chat/chat.graph';
import {
  ChatGraphCompositeDatabase,
  ActiveIntent,
  CreateIntentData,
  UpdateIntentData,
  CreatedIntent,
  ArchiveResult
} from '../lib/protocol/interfaces/database.interface';
import { Scraper } from '../lib/protocol/interfaces/scraper.interface';
import { Embedder } from '../lib/protocol/interfaces/embedder.interface';
import { ProfileDocument } from '../lib/protocol/agents/profile/profile.generator';
import { User } from '../lib/schema';

// --- Adapters ---

import { searchUser } from '../lib/parallel/parallel';

/**
 * Database adapter implementing ChatGraphCompositeDatabase interface.
 * Provides all operations needed by the Chat Graph and its subgraphs
 * (ProfileGraph, IntentGraph, OpportunityGraph).
 */
export class ChatDatabaseAdapter implements ChatGraphCompositeDatabase {

  // ─────────────────────────────────────────────────────────────────────────────
  // Direct ChatGraph operations
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Retrieves a user profile by userId.
   * @param userId - The unique identifier of the user
   * @returns The user's profile or null if not found
   */
  async getProfile(userId: string): Promise<ProfileDocument | null> {
    const result = await db.select()
      .from(schema.userProfiles)
      .where(eq(schema.userProfiles.userId, userId))
      .limit(1);

    // Casting to ProfileDocument - assuming schema matches Agent output structure
    return (result[0] as unknown as ProfileDocument) || null;
  }

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
      console.error("ChatDatabaseAdapter.getActiveIntents error:", error);
      return [];
    }
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // ProfileGraph subgraph requirements
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Retrieves basic user information (name, email, socials) by userId.
   * @param userId - The unique identifier of the user
   * @returns The user record or null if not found
   */
  async getUser(userId: string): Promise<User | null> {
    const result = await db.select()
      .from(schema.users)
      .where(eq(schema.users.id, userId))
      .limit(1);

    return result[0] || null;
  }

  /**
   * Creates or updates a user profile.
   * @param userId - The unique identifier of the user
   * @param profile - The profile data to save
   */
  async saveProfile(userId: string, profile: ProfileDocument): Promise<void> {
    const data = {
      userId,
      identity: profile.identity,
      narrative: profile.narrative,
      attributes: profile.attributes,
      embedding: Array.isArray(profile.embedding[0])
        ? (profile.embedding as number[][])[0]
        : (profile.embedding as number[]),
      updatedAt: new Date()
    };

    await db.insert(schema.userProfiles)
      .values(data)
      .onConflictDoUpdate({
        target: schema.userProfiles.userId,
        set: data
      });
  }

  /**
   * Updates the HyDE (Hypothetical Document Embedding) fields for a user profile.
   * @param userId - The unique identifier of the user
   * @param description - The generated HyDE description
   * @param embedding - The vector embedding of the description
   */
  async saveHydeProfile(userId: string, description: string, embedding: number[]): Promise<void> {
    await db.update(schema.userProfiles)
      .set({
        hydeDescription: description,
        hydeEmbedding: embedding,
        updatedAt: new Date()
      })
      .where(eq(schema.userProfiles.userId, userId));
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // IntentGraph subgraph requirements
  // ─────────────────────────────────────────────────────────────────────────────

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
      console.error("ChatDatabaseAdapter.createIntent error:", error);
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
      console.error("ChatDatabaseAdapter.updateIntent error:", error);
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
      console.error("ChatDatabaseAdapter.archiveIntent error:", error);
      return { success: false, error: error.message || 'Unknown error' };
    }
  }
}

/**
 * Scraper adapter using Parallel.ai for web search.
 * Implements the Scraper interface for profile enrichment.
 */
export class ParallelScraperAdapter implements Scraper {
  /**
   * Scrapes the web for information related to the given objective.
   * @param objective - The search objective/query
   * @returns Formatted search results as a string
   */
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

@Controller('/chat')
export class ChatController {
  private db: ChatGraphCompositeDatabase;
  private embedder: Embedder;
  private scraper: Scraper;
  private factory: ChatGraphFactory;

  constructor() {
    this.db = new ChatDatabaseAdapter();
    // IndexEmbedder (from ../lib/embedder) implements Embedder interface
    this.embedder = new IndexEmbedder();
    this.scraper = new ParallelScraperAdapter();
    this.factory = new ChatGraphFactory(this.db, this.embedder, this.scraper);
  }

  /**
   * Send a message to the chat graph for processing.
   * The graph routes to appropriate subgraphs based on intent analysis.
   *
   * @param req - The HTTP request object (body: { message: string })
   * @param user - The authenticated user from AuthGuard
   * @returns JSON response with graph execution result including responseText
   */
  @Post('/message')
  @UseGuards(AuthGuard)
  async message(req: Request, user: AuthenticatedUser) {
    // 1. Parse request body for message
    let messageContent: string = '';
    try {
      const body = await req.json() as { message?: string };
      messageContent = body.message || '';
    } catch {
      // No body or invalid JSON
      return Response.json(
        { error: 'Invalid request body. Expected { message: string }' },
        { status: 400 }
      );
    }

    if (!messageContent.trim()) {
      return Response.json(
        { error: 'Message content is required' },
        { status: 400 }
      );
    }

    // 2. Create graph and invoke with state
    const graph = this.factory.createGraph();
    const result = await graph.invoke({
      userId: user.id,
      messages: [new HumanMessage(messageContent)]
    });

    // 3. Return response with responseText from graph state
    return Response.json({
      response: result.responseText || '',
      routingDecision: result.routingDecision,
      subgraphResults: result.subgraphResults,
      error: result.error
    });
  }
}
