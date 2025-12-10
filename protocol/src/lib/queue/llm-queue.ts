import { Queue, QueueEvents, Job } from 'bullmq';
import { getRedisClient } from '../redis';

// Use a single queue for all LLM jobs
// Why: Centralizes LLM workload to easily manage concurrency and rate limiting
// for the expensive/limited LLM API resources.
export const QUEUE_NAME = 'llm-processing-queue';

// Job Data Definitions
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
    createdAt?: number | Date; // Allow Date for compat, normalize to number
}

// Get existing Redis connection for reuse
const redisClient = getRedisClient();

// Create the Queue instance
export const queue = new Queue(QUEUE_NAME, {
    connection: {
        ...redisClient.options,
        // BullMQ requires maxRetriesPerRequest to be null for the blocking connection
        // to work correctly. If set, ioredis might retry commands internally, violating
        // the blocking semantics needed for queue workers (e.g., waiting for new jobs).
        maxRetriesPerRequest: null,
    },
    defaultJobOptions: {
        // Retry a failed job up to 3 times
        // Why: Handles transient failures (network blips, temporary service downtime)
        // automatically without human intervention.
        attempts: 3,
        backoff: {
            // Use exponential backoff for retries
            // Why: Prevents overwhelming the system/external APIs if they are down.
            // Retries will wait 1s, 2s, 4s, etc., giving the system time to recover.
            type: 'exponential',
            delay: 1000,
        },
        removeOnComplete: {
            // Keep completed jobs for 24 hours
            // Why: Allows for debugging/auditing of recent successful jobs.
            age: 24 * 3600,
            // Keep at most 1000 completed jobs
            // Why: Prevents Redis memory from filling up if job volume is high,
            // acting as a hard limit on storage usage.
            count: 1000,
        },
        removeOnFail: {
            // Keep failed jobs for 24 hours
            // Why: Crucial for debugging. Allows developers time to inspect why a job failed
            // (e.g., check error messages, stack traces) before it's auto-cleaned.
            age: 24 * 3600,
            // Keep at most 1000 failed jobs
            // Why: Prevents infinite growth of failed jobs consuming memory.
            count: 1000,
        },
    },
});

export const queueEvents = new QueueEvents(QUEUE_NAME, {
    connection: {
        ...redisClient.options,
        // Same requirement as Queue: disable ioredis internal retries to support
        // proper connection handling for event listeners.
        maxRetriesPerRequest: null,
    },
});

/**
 * Add a job to the queue
 */
export async function addJob(
    name: string,
    data: IndexIntentJobData | GenerateIntentsJobData,
    priority: number = 0
): Promise<Job> {
    return queue.add(name, data, {
        // Set priority for the job
        // Why: Allows urgent user-facing tasks to be processed before background tasks.
        // Higher values denote higher priority (processed sooner).
        // e.g., User interactive updates (8) > Background maintenance (4).
        priority: priority > 0 ? priority : undefined,
    });
}

// Helper function to add index intent jobs with userId
export async function addIndexIntentJob(data: IndexIntentJobData, priority: number = 0): Promise<void> {
    await addJob('index_intent', data, priority);
}

// Helper function to add intent generation jobs
export async function addGenerateIntentsJob(data: GenerateIntentsJobData, priority: number = 0): Promise<void> {
    // Normalize createdAt to number
    if (data.createdAt && typeof data.createdAt !== 'number') {
        try {
            data.createdAt = (data.createdAt as Date).getTime();
        } catch (e) {
            data.createdAt = Date.now();
        }
    }

    await addJob('generate_intents', data, priority);
}

// Define QueueStats manually since JobCounts isn't exported in this version
export interface QueueStats {
    waiting: number;
    active: number;
    completed: number;
    failed: number;
    delayed: number;
    paused: number;
    [index: string]: number;
}

/**
 * Get aggregated stats for the queue
 */
export async function getQueueStats(): Promise<QueueStats> {
    const counts = await queue.getJobCounts(
        'active',
        'waiting',
        'completed',
        'failed',
        'delayed',
        'paused'
    );

    // Cast to QueueStats as BullMQ return type is compatible
    return counts as unknown as QueueStats;
}

/**
 * Get job history (completed/failed)
 */
export async function getJobHistory(limit: number = 50): Promise<Job[]> {
    // Get recent completed and failed jobs
    const [completed, failed] = await Promise.all([
        queue.getJobs(['completed'], 0, limit - 1, true),
        queue.getJobs(['failed'], 0, limit - 1, true),
    ]);

    // Merge and sort by finishedOn timestamp descending
    const all = [...completed, ...failed].sort((a, b) => {
        return (b.finishedOn || 0) - (a.finishedOn || 0);
    });

    return all.slice(0, limit);
}
