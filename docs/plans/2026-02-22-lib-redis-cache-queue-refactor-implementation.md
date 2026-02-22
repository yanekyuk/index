# lib/redis, Cache, and Email Queue Refactor — Implementation Plan

**Goal:** Eliminate `lib/redis.ts` by splitting it into cache adapter and BullMQ module, consolidate the email queue into a template-conforming class, and remove dead code.

**Architecture:** Redis connection management splits into two owners — `adapters/cache.adapter.ts` owns `getRedisClient()` for caching, `lib/bullmq/bullmq.ts` owns `getBullMQConnection()` for queue connections. The email queue becomes a class-based file in `queues/` using QueueFactory.

**Tech Stack:** BullMQ, ioredis, Bun runtime, TypeScript

**Worktree:** `.worktrees/refactor-lib` (branch `refactor/lib-cleanup`)

---

## Prerequisites

Already completed on this branch:
- Deleted 4 unused files: `agent-ids.ts`, `embeddings.ts`, `index-access.ts`, `user-utils.ts`
- Deleted duplicate `parallels.ts`, updated `web_crawler.ts` import to `lib/parallel/parallel.ts`
- Design doc committed

---

### Task 1: Move `getRedisClient` and `closeRedisConnection` into `cache.adapter.ts`

**Files:**
- Modify: `protocol/src/adapters/cache.adapter.ts`
- Reference: `protocol/src/lib/redis.ts` (source of functions to move)

**Step 1: Add Redis imports and connection code to cache.adapter.ts**

Add at the top of `cache.adapter.ts`, before the existing `RedisCacheAdapter` class:

```typescript
import Redis, { type RedisOptions } from 'ioredis';
import { log } from '../lib/log';
import type { Cache, CacheOptions } from '../lib/protocol/interfaces/cache.interface';

const logger = log.lib.from("cache.adapter");

let redis: Redis | null = null;

/**
 * Get the shared Redis client for general caching/operations.
 * Uses lazyConnect for efficiency in the main client.
 */
export function getRedisClient(): Redis {
  if (!redis) {
    const redisUrl = process.env.REDIS_URL;

    if (redisUrl) {
      redis = new Redis(redisUrl, {
        maxRetriesPerRequest: 3,
        lazyConnect: true
      });
    } else {
      redis = new Redis({
        host: process.env.REDIS_HOST || 'localhost',
        port: parseInt(process.env.REDIS_PORT || '6379'),
        password: process.env.REDIS_PASSWORD,
        db: parseInt(process.env.REDIS_DB || '0'),
        maxRetriesPerRequest: 3,
        lazyConnect: true
      });
    }

    redis.on('error', (err: Error) => {
      logger.error('Redis error', { error: err.message });
    });

    redis.on('connect', () => {
      logger.info('Redis connected');
    });
  }

  return redis;
}

export async function closeRedisConnection(): Promise<void> {
  if (redis) {
    await redis.quit();
    redis = null;
  }
}
```

Remove the old import line `import { getRedisClient } from '../lib/redis';` since `getRedisClient` is now defined locally.

**Step 2: Verify cache.adapter.ts compiles**

Run: `cd protocol && npx tsc --noEmit src/adapters/cache.adapter.ts 2>&1 | head -20`

**Step 3: Commit**

```bash
git add protocol/src/adapters/cache.adapter.ts
git commit -m "refactor: move getRedisClient into cache.adapter.ts"
```

---

### Task 2: Move `getBullMQConnection` into `lib/bullmq/bullmq.ts` and update QueueFactory

**Files:**
- Modify: `protocol/src/lib/bullmq/bullmq.ts`
- Reference: `protocol/src/lib/redis.ts` (source of function to move)

**Step 1: Replace QueueFactory's Redis connection logic**

Replace the current top of `bullmq.ts`:

```typescript
import { getRedisClient } from '../redis';
// ...
const redisClient = getRedisClient();
const SHARED_REDIS_OPTS = {
  ...redisClient.options,
  maxRetriesPerRequest: null,
};
```

With:

```typescript
import Redis, { type RedisOptions } from 'ioredis';
// ...

/**
 * Get BullMQ-compatible Redis connection options.
 * BullMQ requires maxRetriesPerRequest: null (for blocking commands)
 * and lazyConnect: false (workers need active connection to receive jobs).
 */
function getBullMQConnection(): RedisOptions {
  const redisUrl = process.env.REDIS_URL;

  if (redisUrl) {
    const url = new URL(redisUrl);
    return {
      host: url.hostname,
      port: parseInt(url.port) || 6379,
      password: url.password || undefined,
      username: url.username || undefined,
      db: url.pathname ? parseInt(url.pathname.slice(1)) || 0 : 0,
      maxRetriesPerRequest: null,
      lazyConnect: false,
      enableReadyCheck: false,
    };
  }

  return {
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT || '6379'),
    password: process.env.REDIS_PASSWORD || undefined,
    db: parseInt(process.env.REDIS_DB || '0'),
    maxRetriesPerRequest: null,
    lazyConnect: false,
    enableReadyCheck: false,
  };
}

const SHARED_REDIS_OPTS = getBullMQConnection();
```

Note: `getBullMQConnection` is **not exported** — it's private to this module. QueueFactory is the sole consumer.

**Step 2: Commit**

```bash
git add protocol/src/lib/bullmq/bullmq.ts
git commit -m "refactor: move getBullMQConnection into bullmq module, remove indirect Redis patch"
```

---

### Task 3: Delete `lib/redis.ts` and update all remaining imports

**Files:**
- Delete: `protocol/src/lib/redis.ts`
- Modify: `protocol/src/queues/notification.queue.ts` (line 9)
- Modify: `protocol/src/adapters/tests/cache.adapter.spec.ts` (line 10)

**Step 1: Update notification.queue.ts import**

Change line 9:
```typescript
// OLD:
import { getRedisClient } from '../lib/redis';
// NEW:
import { getRedisClient } from '../adapters/cache.adapter';
```

**Step 2: Update cache.adapter.spec.ts import**

Change line 10:
```typescript
// OLD:
import { getRedisClient } from '../../lib/redis';
// NEW:
import { getRedisClient } from '../cache.adapter';
```

**Step 3: Delete lib/redis.ts**

```bash
rm protocol/src/lib/redis.ts
```

**Step 4: Verify no remaining imports of lib/redis**

Run: `grep -r "from.*lib/redis" protocol/src/ --include="*.ts"`
Expected: No matches

**Step 5: Commit**

```bash
git add -A protocol/src/lib/redis.ts protocol/src/queues/notification.queue.ts protocol/src/adapters/tests/cache.adapter.spec.ts
git commit -m "refactor: delete lib/redis.ts, update imports to cache.adapter"
```

---

### Task 4: Create consolidated `queues/email.queue.ts`

**Files:**
- Create: `protocol/src/queues/email.queue.ts`
- Reference: `protocol/src/lib/email/queue/email.queue.ts` (old queue)
- Reference: `protocol/src/lib/email/queue/email.worker.ts` (old worker)
- Reference: `protocol/src/lib/email/queue/email.processor.ts` (old processor)

**Step 1: Create the new email queue class**

Create `protocol/src/queues/email.queue.ts`:

```typescript
import { Job } from 'bullmq';

import { log } from '../lib/log';
import { QueueFactory } from '../lib/bullmq/bullmq';
import { executeSendEmail } from '../lib/email/transport.helper';

export const QUEUE_NAME = 'email-processing-queue';

export interface EmailJobData {
  to: string | string[];
  subject: string;
  html: string;
  text: string;
  /** Optional Resend headers (e.g. List-Unsubscribe). */
  headers?: Record<string, string>;
}

export interface AddEmailJobOptions {
  priority?: number;
  /** When set, BullMQ uses this as job id (deduplicates pending jobs with same id). */
  jobId?: string;
}

/**
 * Email queue: BullMQ queue, worker, and job handlers for sending emails via Resend.
 *
 * Workers are started only by the protocol server via {@link EmailQueue.startWorker}.
 * CLI scripts may add jobs without starting a worker.
 *
 * @remarks Preserves email-specific settings: 5 attempts, rate limiter (max 2 per second).
 */
export class EmailQueue {
  static readonly QUEUE_NAME = QUEUE_NAME;

  readonly queue = QueueFactory.createQueue<EmailJobData>(QUEUE_NAME, {
    defaultJobOptions: {
      attempts: 5,
      backoff: { type: 'exponential', delay: 1000 },
      removeOnComplete: { age: 24 * 3600, count: 1000 },
      removeOnFail: { age: 7 * 24 * 3600, count: 1000 },
    },
  });

  readonly queueEvents = QueueFactory.createQueueEvents(QUEUE_NAME);

  private readonly logger = log.job.from('EmailJob');
  private readonly queueLogger = log.queue.from('EmailQueue');
  private worker: ReturnType<typeof QueueFactory.createWorker<EmailJobData>> | null = null;

  /**
   * Add an email job to the queue.
   * @param data - Email payload (to, subject, html, text, headers)
   * @param options - Optional priority and jobId for deduplication
   * @returns The BullMQ job
   */
  async addJob(
    data: EmailJobData,
    options?: AddEmailJobOptions
  ): Promise<Job<EmailJobData>> {
    const priority = options?.priority ?? 1;
    const job = await this.queue.add('send_email', data, {
      priority: priority > 0 ? priority : undefined,
      jobId: options?.jobId,
    });
    this.queueLogger.debug(`[EmailQueue] Job added with ID: ${job.id}`, {
      priority,
      jobId: options?.jobId,
    });
    return job;
  }

  /**
   * Run job handler for a given job name and payload. Used by the worker and by tests.
   * @param name - Job name (`send_email`)
   * @param data - Email payload
   */
  async processJob(name: string, data: EmailJobData): Promise<void> {
    this.queueLogger.info(`[EmailProcessor] Processing job (${name})`);
    switch (name) {
      case 'send_email':
        await this.handleSendEmail(data);
        break;
      default:
        this.queueLogger.warn(`[EmailProcessor] Unknown job name: ${name}`);
    }
  }

  /**
   * Start the BullMQ worker for this queue. Idempotent; call from the protocol server only.
   */
  startWorker(): void {
    if (this.worker) return;
    const processor = async (job: Job<EmailJobData>) => {
      this.queueLogger.info(`[EmailProcessor] Processing job ${job.id} (${job.name})`);
      await this.processJob(job.name, job.data);
    };
    this.worker = QueueFactory.createWorker<EmailJobData>(QUEUE_NAME, processor, {
      limiter: { max: 2, duration: 1000 },
    });
    this.worker.on('failed', (job, err) => {
      this.logger.error('Email job failed', { jobId: job?.id, error: err });
    });
    this.worker.on('completed', (job) => {
      if (job) {
        this.logger.info('Email job sent', { jobId: job.id, to: job.data.to });
      }
    });
    this.worker.on('error', (err) => {
      this.logger.error('Worker error', { error: err });
    });
  }

  private async handleSendEmail(data: EmailJobData): Promise<any> {
    const result = await executeSendEmail(data);
    return result;
  }
}

/** Singleton email queue instance. */
export const emailQueue = new EmailQueue();
```

**Step 2: Commit**

```bash
git add protocol/src/queues/email.queue.ts
git commit -m "refactor: create consolidated email queue class using QueueFactory"
```

---

### Task 5: Update email consumers to use new queue

**Files:**
- Modify: `protocol/src/lib/email/transport.helper.ts` (lines 2, 124, 130)
- Modify: `protocol/src/queues/notification.queue.ts` (line 6, line 220-233)
- Modify: `protocol/src/controllers/queues.controller.ts` (line 17, line 34)
- Modify: `protocol/src/main.ts` (add emailQueue import and startWorker)

**Step 1: Update transport.helper.ts**

Change line 2:
```typescript
// OLD:
import { addEmailJob, emailQueueEvents } from './queue/email.queue';
// NEW:
import { emailQueue } from '../../queues/email.queue';
```

Change `sendEmail` function (line 124) to use `emailQueue.addJob` and `emailQueue.queueEvents`:
```typescript
export const sendEmail = async (options: {
  to: string | string[];
  subject: string;
  html: string;
  text: string;
  headers?: Record<string, string>;
}): Promise<any> => {
  const job = await emailQueue.addJob(options);

  const WAIT_TIMEOUT_MS = 60000;

  try {
    const result = await job.waitUntilFinished(emailQueue.queueEvents, WAIT_TIMEOUT_MS);

    if (result == null) {
      const jobState = await job.getState();
      const returnValue = job.returnvalue;

      if (jobState === 'waiting' || jobState === 'active' || jobState === 'delayed') {
        logger.error(`[EmailTransport] Email job ${job.id} timed out or not processed`, { jobState });
      } else if (jobState === 'completed') {
        return returnValue;
      }

      return returnValue || result;
    }

    return result;
  } catch (error) {
    const jobState = await job.getState().catch(() => 'unknown');
    logger.error(`[EmailTransport] Email job ${job.id} error while waiting`, {
      error: error instanceof Error ? error.message : String(error),
      jobState,
    });
    throw error;
  }
};
```

**Step 2: Update notification.queue.ts**

Change line 6:
```typescript
// OLD:
import { addEmailJob } from '../lib/email/queue/email.queue';
// NEW:
import { emailQueue } from './email.queue';
```

Change line 220-233 (`addEmailJob(...)` call) to:
```typescript
await emailQueue.addJob(
  {
    to: recipient.email,
    subject: template.subject,
    html: template.html,
    text: template.text,
    headers: unsubscribeUrl
      ? {
            'List-Unsubscribe': `<mailto:hello@index.network?subject=Unsubscribe>, <${unsubscribeUrl}>`,
            'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
          }
      : undefined,
  },
  { jobId: `opportunity-email:${recipientId}:${opportunityId}` }
);
```

**Step 3: Update queues.controller.ts**

Change line 17:
```typescript
// OLD:
import { emailQueue } from '../lib/email/queue/email.queue';
// NEW:
import { emailQueue } from '../queues/email.queue';
```

Change line 34 — `emailQueue` is now a class instance with `.queue` property:
```typescript
// OLD:
new BullMQAdapter(emailQueue),
// NEW:
new BullMQAdapter(emailQueue.queue),
```

**Step 4: Update main.ts**

Add import after the other queue imports (around line 24):
```typescript
import { emailQueue } from './queues/email.queue';
```

Add `startWorker` call after the other queue startups (around line 29):
```typescript
emailQueue.startWorker();
```

**Step 5: Commit**

```bash
git add protocol/src/lib/email/transport.helper.ts protocol/src/queues/notification.queue.ts protocol/src/controllers/queues.controller.ts protocol/src/main.ts
git commit -m "refactor: update all consumers to use consolidated email queue"
```

---

### Task 6: Delete old email queue files

**Files:**
- Delete: `protocol/src/lib/email/queue/email.queue.ts`
- Delete: `protocol/src/lib/email/queue/email.worker.ts`
- Delete: `protocol/src/lib/email/queue/email.processor.ts`

**Step 1: Verify no remaining imports of old email queue files**

Run: `grep -r "from.*email/queue/email" protocol/src/ --include="*.ts"`
Expected: No matches (only the deleted files should have referenced each other)

**Step 2: Delete the files**

```bash
rm protocol/src/lib/email/queue/email.queue.ts
rm protocol/src/lib/email/queue/email.worker.ts
rm protocol/src/lib/email/queue/email.processor.ts
```

If the `queue/` directory is now empty, delete it:
```bash
rmdir protocol/src/lib/email/queue/ 2>/dev/null || true
```

**Step 3: Commit**

```bash
git add -A protocol/src/lib/email/queue/
git commit -m "refactor: delete old email queue/worker/processor files"
```

---

### Task 7: Verify build and tests

**Step 1: Check for broken imports across entire protocol**

Run: `grep -r "from.*lib/redis" protocol/src/ --include="*.ts"`
Expected: No matches

Run: `grep -r "from.*email/queue/email" protocol/src/ --include="*.ts"`
Expected: No matches

**Step 2: Run TypeScript check**

Run: `cd protocol && bunx tsc --noEmit 2>&1 | head -40`
Expected: No errors

**Step 3: Run cache adapter tests**

Run: `cd protocol && bun test src/adapters/tests/cache.adapter.spec.ts`
Expected: All tests pass

**Step 4: Commit the full cleanup (if any final fixes needed)**

```bash
git add -A
git commit -m "refactor: verify and fix any remaining import issues"
```

---

## Summary of all files changed

| Action | File |
|--------|------|
| Modify | `protocol/src/adapters/cache.adapter.ts` — add `getRedisClient`, `closeRedisConnection` |
| Modify | `protocol/src/lib/bullmq/bullmq.ts` — add `getBullMQConnection` (private), use directly |
| Modify | `protocol/src/queues/notification.queue.ts` — update 2 imports |
| Modify | `protocol/src/adapters/tests/cache.adapter.spec.ts` — update 1 import |
| Modify | `protocol/src/lib/email/transport.helper.ts` — update import, use `emailQueue` |
| Modify | `protocol/src/controllers/queues.controller.ts` — update import, use `emailQueue.queue` |
| Modify | `protocol/src/main.ts` — add `emailQueue.startWorker()` |
| Create | `protocol/src/queues/email.queue.ts` — consolidated email queue class |
| Delete | `protocol/src/lib/redis.ts` |
| Delete | `protocol/src/lib/email/queue/email.queue.ts` |
| Delete | `protocol/src/lib/email/queue/email.worker.ts` |
| Delete | `protocol/src/lib/email/queue/email.processor.ts` |
