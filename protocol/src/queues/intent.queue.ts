import { Job } from 'bullmq';
import { QueueFactory } from '../lib/bullmq/bullmq';
import { ExplicitIntentInferrer } from '../agents/intent/inferrer/explicit/explicit.inferrer';
import { profileService } from '../services/profile.service';
import { intentService } from '../services/intent.service';
import { IndexGraphFactory } from '../lib/protocol/graphs/index/index.graph';
import { IndexGraphDatabaseAdapter, ChatDatabaseAdapter } from '../adapters/database.adapter';
import { createIntentQueueAdapter } from '../adapters/queue.adapter';
import { EmbedderAdapter } from '../adapters/embedder.adapter';
import { RedisCacheAdapter } from '../adapters/cache.adapter';
import type { HydeGraphDatabase } from '../lib/protocol/interfaces/database.interface';
import { HydeGraphFactory } from '../lib/protocol/graphs/hyde/hyde.graph';
import { HydeGenerator } from '../lib/protocol/agents/hyde/hyde.generator';
import { log } from '../lib/log';

const logger = log.queue.from("IntentQueue");

/** Persisted HyDE strategies to pre-generate on intent create/update. */
const PERSISTED_HYDE_STRATEGIES = ['mirror', 'reciprocal'] as const;

/**
 * Queue Name Constant
 */
export const QUEUE_NAME = 'intent-processing-queue';

/**
 * Job Data Interface: Index Intent
 * 
 * Payload for the `index_intent` job.
 */
export interface IndexIntentJobData {
  /** The ID of the intent to evaluate */
  intentId: string;
  /** The ID of the index (community) to evaluate against */
  indexId: string;
  /** The user ID owning the intent */
  userId: string;
}

/**
 * Job Data Interface: Generate Intents
 * 
 * Payload for the `generate_intents` job.
 */
export interface GenerateIntentsJobData {
  /** The user ID for whom intents are being generated */
  userId: string;
  /** Unique ID of the source content */
  sourceId: string;
  /** The type of source providing the content */
  sourceType: 'file' | 'link' | 'integration' | 'discovery_form';
  /** Raw text content to analyze */
  content?: string;
  /** Array of raw objects (if content is structured) */
  objects?: any[];
  /** Optional Index ID to associate generated intents with */
  indexId?: string;
  /** Expected number of intents to generate (hint) */
  intentCount?: number;
  /** Specific user instruction for generation */
  instruction?: string;
  /** Timestamp override for creation date */
  createdAt?: number | Date;
}

/**
 * Job Data Interface: HyDE generation for an intent (create or refresh).
 */
export interface HydeIntentJobData {
  intentId: string;
}

/**
 * Intent Processing Queue.
 * 
 * RESPONSIBILITIES:
 * 1. `index_intent`: Evaluates if a new intent should be added to specific Indexes (Communities).
 * 2. `generate_intents`: Background job to analyze raw content (files/links) and extract structured intents.
 */
export const intentQueue = QueueFactory.createQueue(QUEUE_NAME);

// Processor Function
async function intentProcessor(job: Job) {
  logger.info(`[IntentProcessor] Processing job ${job.id} (${job.name})`);

  switch (job.name) {
    case 'index_intent':
      await indexIntent(job.data as IndexIntentJobData);
      break;
    case 'generate_intents':
      await generateIntents(job.data as GenerateIntentsJobData);
      break;
    case 'generate_hyde':
      await generateHydeForIntent(job.data as HydeIntentJobData);
      break;
    case 'refresh_hyde':
      await refreshHydeForIntent(job.data as HydeIntentJobData);
      break;
    default:
      logger.warn(`[IntentProcessor] Unknown job name: ${job.name}`);
  }
}

/**
 * Job: `index_intent`
 *
 * Evaluates appropriateness of an intent for a specific index using the Index Graph.
 * Graph: prep → evaluate (IntentIndexer) → execute (assign/unassign).
 *
 * @param data - Job payload containing intent and index IDs.
 */
async function indexIntent(data: IndexIntentJobData): Promise<void> {
  const { intentId, indexId } = data;
  const adapter = new IndexGraphDatabaseAdapter();
  const graph = new IndexGraphFactory(adapter).createGraph();
  await graph.invoke({ intentId, indexId });
}

/**
 * Job: `generate_intents`
 * 
 * Asynchronous pipeline for extracting intents from large/complex sources.
 * 
 * FLOW:
 * 1. Takes Source (File, Link, or Raw Objects).
 * 2. Fetches User Profile Context.
 * 3. Calls `ExplicitIntentInferrer` (LLM Agent).
 * 4. Deduplicates against existing user intents.
 * 5. Persists new intents to DB.
 * 
 * @param data - Job payload containing content and source metadata.
 */
async function generateIntents(data: GenerateIntentsJobData): Promise<void> {
  const { userId, content, objects, instruction } = data;

  // 1. Get User Profile for Context
  const userProfile = await profileService.getProfile(userId);
  if (!userProfile) {
    logger.warn(`[IntentQueue] Missing profile for user ${userId}, skipping generation.`);
    return;
  }

  // Build Profile Context for Agent
  const profileContext = `
    Bio: ${userProfile.identity?.bio || 'None'}
    Narrative: ${userProfile.narrative?.context || 'None'}
    Interests: ${(userProfile.attributes?.interests || []).join(', ')}
    Skills: ${(userProfile.attributes?.skills || []).join(', ')}
  `;

  // 2. Prepare Content
  let analysisContent = content || '';
  if (objects && objects.length > 0) {
    analysisContent = objects.map(obj => JSON.stringify(obj)).join('\n\n');
  }

  if (instruction) {
    analysisContent = `[User Instruction: ${instruction}]\n\n${analysisContent}`;
  }

  if (!analysisContent.trim()) {
    return;
  }

  // 3. Call Agent
  const agent = new ExplicitIntentInferrer();
  const result = await agent.run(analysisContent, profileContext);

  if (!result || !result.intents) return;

  // 4. Get existing intents for dedup
  const existingIntents = await intentService.getUserIntents(userId);

  // 5. Persist
  for (const intent of result.intents) {
    // Basic dedup check
    if (!existingIntents.has(intent.description)) {
      await intentService.createIntent({
        payload: intent.description,
        userId: userId,
        sourceId: data.sourceId,
        sourceType: data.sourceType,
        indexIds: data.indexId ? [data.indexId] : [],
        // Map confidence enum to number (high=0.9, medium=0.7, low=0.4)
        confidence: intent.confidence === 'high' ? 0.9 : intent.confidence === 'medium' ? 0.7 : 0.4,
        inferenceType: 'explicit', // Agent is ExplicitIntentInferrer
        ...(data.createdAt && { createdAt: new Date(data.createdAt), updatedAt: new Date(data.createdAt) })
      });
      existingIntents.add(intent.description);
    }
  }
}

/**
 * Job: `generate_hyde` — Pre-generate HyDE documents for a new intent (persisted strategies).
 */
async function generateHydeForIntent(data: HydeIntentJobData): Promise<void> {
  const { intentId } = data;
  const db = new ChatDatabaseAdapter();
  const intent = await db.getIntentForIndexing(intentId);
  if (!intent) {
    logger.warn(`[IntentProcessor:generate_hyde] Intent not found: ${intentId}`);
    return;
  }
  const embedder = new EmbedderAdapter();
  const cache = new RedisCacheAdapter();
  const generator = new HydeGenerator();
  const hydeGraph = new HydeGraphFactory(
    db as unknown as HydeGraphDatabase,
    embedder,
    cache,
    generator
  ).createGraph();
  await hydeGraph.invoke({
    sourceText: intent.payload,
    sourceType: 'intent',
    sourceId: intentId,
    strategies: [...PERSISTED_HYDE_STRATEGIES],
    forceRegenerate: false,
  });
  logger.info(`[IntentProcessor:generate_hyde] Generated HyDE for intent ${intentId}`);
}

/**
 * Job: `refresh_hyde` — Regenerate HyDE documents for an updated intent.
 */
async function refreshHydeForIntent(data: HydeIntentJobData): Promise<void> {
  const { intentId } = data;
  const db = new ChatDatabaseAdapter();
  const intent = await db.getIntentForIndexing(intentId);
  if (!intent) {
    logger.warn(`[IntentProcessor:refresh_hyde] Intent not found: ${intentId}`);
    return;
  }
  const embedder = new EmbedderAdapter();
  const cache = new RedisCacheAdapter();
  const generator = new HydeGenerator();
  const hydeGraph = new HydeGraphFactory(
    db as unknown as HydeGraphDatabase,
    embedder,
    cache,
    generator
  ).createGraph();
  await hydeGraph.invoke({
    sourceText: intent.payload,
    sourceType: 'intent',
    sourceId: intentId,
    strategies: [...PERSISTED_HYDE_STRATEGIES],
    forceRegenerate: true,
  });
  logger.info(`[IntentProcessor:refresh_hyde] Refreshed HyDE for intent ${intentId}`);
}

export const intentWorker = QueueFactory.createWorker(QUEUE_NAME, intentProcessor);
export const queueEvents = QueueFactory.createQueueEvents(QUEUE_NAME);

/**
 * Add a job to the Intent Queue.
 * 
 * @param name - The name of the job ('index_intent' or 'generate_intents').
 * @param data - The payload for the job.
 * @param priority - Optional priority level (higher number = higher priority).
 * @returns The created Job instance.
 */
export async function addJob(
  name: string,
  data: IndexIntentJobData | GenerateIntentsJobData | HydeIntentJobData,
  priority: number = 0
): Promise<Job> {
  return intentQueue.add(name, data, {
    priority: priority > 0 ? priority : undefined,
  });
}

/** Adapter implementing IntentQueue; use for DI or when depending on the adapter contract. */
export const intentQueueAdapter = createIntentQueueAdapter(intentQueue);


