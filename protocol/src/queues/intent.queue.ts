import { Job } from 'bullmq';
import { QueueFactory } from '../lib/bullmq/bullmq';
import { analyzeObjects, analyzeContent } from '../agents/core/intent_inferrer';
import { IntentService, intentService } from '../services/intent.service';
import { log } from '../lib/log';

export const QUEUE_NAME = 'intent-processing-queue';

export interface IndexIntentJobData {
  intentId: string;
  indexId: string;
  userId: string;
}

export interface GenerateIntentsJobData {
  userId: string;
  sourceId: string;
  sourceType: 'file' | 'link' | 'integration' | 'discovery_form';
  content?: string;
  objects?: any[];
  indexId?: string;
  intentCount?: number;
  instruction?: string;
  createdAt?: number | Date;
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
  log.info(`[IntentProcessor] Processing job ${job.id} (${job.name})`);

  switch (job.name) {
    case 'index_intent':
      await indexIntent(job.data as IndexIntentJobData);
      break;
    case 'generate_intents':
      await generateIntents(job.data as GenerateIntentsJobData);
      break;
    default:
      log.warn(`[IntentProcessor] Unknown job name: ${job.name}`);
  }
}

/**
 * Job: `index_intent`
 * 
 * Evaluates appropriateness of an intent for a specific index.
 * Relies on `IntentService.processIntentForIndex` which uses LLM evaluation.
 */
async function indexIntent(data: IndexIntentJobData): Promise<void> {
  const { intentId, indexId } = data;
  await IntentService.processIntentForIndex(intentId, indexId);
}

/**
 * Job: `generate_intents`
 * 
 * Asynchronous pipeline for extracting intents from large/complex sources.
 * 
 * FLOW:
 * 1. Takes Source (File, Link, or Raw Objects).
 * 2. Calls `analyzeContent` (LLM Agent).
 * 3. Deduplicates against existing user intents.
 * 4. Persists new intents to DB.
 */
async function generateIntents(data: GenerateIntentsJobData): Promise<void> {
  // Get existing intents
  const existingIntents = await intentService.getUserIntents(data.userId);

  let result;
  if (data.content) {
    // File/Link: use analyzeContent
    result = await analyzeContent(
      data.content,
      1, // itemCount
      data.instruction,
      Array.from(existingIntents),
      60000
    );
  } else if (data.objects) {
    // Integration: use analyzeObjects
    result = await analyzeObjects(
      data.objects,
      data.instruction,
      Array.from(existingIntents),
      60000
    );
  }

  if (result?.success && result.intents) {
    for (const intentData of result.intents) {
      if (!existingIntents.has(intentData.payload)) {
        await intentService.createIntent({
          payload: intentData.payload,
          userId: data.userId,
          sourceId: data.sourceId,
          sourceType: data.sourceType,
          indexIds: data.indexId ? [data.indexId] : [],
          confidence: intentData.confidence,
          inferenceType: intentData.type,
          ...(data.createdAt && { createdAt: new Date(data.createdAt), updatedAt: new Date(data.createdAt) })
        });
        existingIntents.add(intentData.payload);
      }
    }
  }
}

export const intentWorker = QueueFactory.createWorker(QUEUE_NAME, intentProcessor);
export const queueEvents = QueueFactory.createQueueEvents(QUEUE_NAME);

export async function addJob(
  name: string,
  data: IndexIntentJobData | GenerateIntentsJobData,
  priority: number = 0
): Promise<Job> {
  return intentQueue.add(name, data, {
    priority: priority > 0 ? priority : undefined,
  });
}

export async function addIndexIntentJob(data: IndexIntentJobData, priority: number = 0): Promise<Job> {
  return await addJob('index_intent', data, priority);
}

export async function addGenerateIntentsJob(data: GenerateIntentsJobData, priority: number = 0): Promise<void> {
  if (data.createdAt && typeof data.createdAt !== 'number') {
    try {
      data.createdAt = (data.createdAt as Date).getTime();
    } catch (e) {
      data.createdAt = Date.now();
    }
  }
  await addJob('generate_intents', data, priority);
}
