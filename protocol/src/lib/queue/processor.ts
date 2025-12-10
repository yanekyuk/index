import { Worker, Job } from 'bullmq';
import { QUEUE_NAME, IndexIntentJobData, GenerateIntentsJobData } from './llm-queue';
import { intentIndexer } from '../../agents/core/intent_indexer';
import { getRedisClient } from '../redis';
import { analyzeObjects, analyzeContent } from '../../agents/core/intent_inferrer';
import { IntentService } from '../intent-service';

// Job types from adapter - we use these for type safety
type JobData = IndexIntentJobData | GenerateIntentsJobData;

export class QueueProcessor {
  private worker: Worker;
  private redis = getRedisClient();

  constructor(concurrency: number = parseInt(process.env.QUEUE_CONCURRENCY || '3')) {
    this.worker = new Worker(QUEUE_NAME, this.processJob.bind(this), {
      connection: {
        ...this.redis.options,
        maxRetriesPerRequest: null,
      },
      // Concurrency: How many jobs THIS worker can process in parallel.
      // 
      // Limiter: Global rate limit for the queue across ALL workers.
      //
      // Examples:
      // Case A (High Throughput):
      //   - 5 workers running in different pods/processes
      //   - concurrency: 20 (each worker takes 20 jobs)
      //   - limiter: max 1000 / 1 sec
      //   -> Result: System processes ~100 jobs simultaneously, up to 1000/sec total.
      //
      // Case B (Rate Limited API):
      //   - 10 workers
      //   - concurrency: 5
      //   - limiter: max 10 / 1 sec (some API limit)
      //   -> Result: Even though we could process 50 jobs at once (10*5), 
      //      BullMQ will only lease 10 jobs every second to respect the API limit.
      //
      // Case C (CPU Heavy Tasks):
      //   - 2 workers (on 2 core machines)
      //   - concurrency: 1 (processing takes 100% CPU)
      //   - limiter: unlimited
      //   -> Result: 2 jobs processed at once total.
      concurrency,
      limiter: {
        max: 100,
        duration: 1000
      }
    });

    this.worker.on('completed', (job) => {
      console.log(`Job ${job.id} completed!`);
    });

    this.worker.on('failed', (job, err) => {
      console.error(`Job ${job?.id} failed with ${err.message}`);
    });

    this.worker.on('error', (err) => {
      console.error(`Worker error: ${err.message}`);
    });
  }

  start(): void {
    if (this.worker.isPaused()) {
      this.worker.resume();
    }
  }

  async stop(): Promise<void> {
    await this.worker.close();
  }

  // This is the core processor function called by BullMQ
  private async processJob(job: Job<JobData>): Promise<void> {
    console.log(`Processing job ${job.id} (${job.name})`);

    switch (job.name) {
      case 'index_intent':
        await this.indexIntent(job.data as IndexIntentJobData);
        break;
      case 'generate_intents':
        await this.generateIntents(job.data as GenerateIntentsJobData);
        break;
      default:
        console.warn(`Unknown job name: ${job.name}`);
    }
  }

  private async indexIntent(data: IndexIntentJobData): Promise<void> {
    const { intentId, indexId } = data;
    await intentIndexer.processIntentForIndex(intentId, indexId);
  }

  private async generateIntents(data: GenerateIntentsJobData): Promise<void> {
    // Get existing intents
    const existingIntents = await IntentService.getUserIntents(data.userId);

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
          await IntentService.createIntent({
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
}

export const queueProcessor = new QueueProcessor();
