# Queue Implementation Guide

Queues are used to offload asynchronous or heavy tasks from the main request/response cycle. We use `bullmq` wrapped in a custom `QueueFactory`.

## Location & Naming
- **File**: \`src/queues/<domain>.queue.ts\` (e.g., \`intent.queue.ts\`)
- **Queue Name**: kebab-case string, typically \`<domain>-processing-queue\`.
- **Exports**: 
  - \`<domain>Queue\` (The Queue instance)
  - \`<domain>Worker\` (The Worker instance)
  - \`queueEvents\` (The QueueEvents instance)
  - \`addJob\` (Helper function)

## Standard Template

All queues should follow this structure. Notice that types are defined **in the same file**.

\`\`\`typescript
import { Job } from 'bullmq';
import { QueueFactory } from '../lib/bullmq/bullmq';
import { log } from '../lib/log';

/**
 * Queue Name Constant
 */
export const QUEUE_NAME = 'my-domain-queue';

/**
 * Job Interface
 * Define the payload structure for your job.
 */
export interface MyJobData {
  /** ID of the entity being processed */
  entityId: string;
  /** Action to perform */
  action: 'process' | 'analyze';
}

/**
 * [Queue Name]
 * 
 * RESPONSIBILITIES:
 * 1. [Responsibility 1]
 * 2. [Responsibility 2]
 */
export const myQueue = QueueFactory.createQueue(QUEUE_NAME);

// Processor Function
async function myProcessor(job: Job) {
  log.info(\`[MyProcessor] Processing job \${job.id} (\${job.name})\`);

  switch (job.name) {
    case 'job_type_one':
      await handleJobTypeOne(job.data as MyJobData);
      break;
    default:
      log.warn(\`[MyProcessor] Unknown job name: \${job.name}\`);
  }
}

/**
 * Job Handler: job_type_one
 * 
 * [Description of what this job does]
 * 
 * @param data - The job payload
 */
async function handleJobTypeOne(data: MyJobData): Promise<void> {
  const { entityId } = data;
  // Implement logic here, calling Services or Agents
  // await myService.process(entityId);
}

// Export Worker and Events
export const myWorker = QueueFactory.createWorker(QUEUE_NAME, myProcessor);
export const queueEvents = QueueFactory.createQueueEvents(QUEUE_NAME);

/**
 * Add a job to the Queue.
 * 
 * @param name - The name of the job
 * @param data - The payload for the job
 * @param priority - Optional priority level (higher number = higher priority)
 * @returns The created Job instance
 */
export async function addJob(
  name: string,
  data: MyJobData,
  priority: number = 0
): Promise<Job> {
  return myQueue.add(name, data, {
    priority: priority > 0 ? priority : undefined,
  });
}
\`\`\`

## Best Practices

### 1. Type Safety
- Always define interfaces for your job data.
- Cast `job.data` to your interface inside the processor or handler.

### 2. Job Names
- Use snake_case for job names (e.g., `index_intent`, `generate_profile`).
- Use a `switch` statement in the processor to route to specific handler functions.

### 3. Error Handling
- The `QueueFactory` handles basic error logging.
- If a job fails, it will be retried according to the default configuration.
- Handle specific errors inside your handler if you want to abort retries (e.g., throw `UnrecoverableError`).

### 4. Dependencies & Data Access
- **No Direct DB Access**: It is not allowed to import `db` from here. Instead, there should be a service file or method that is responsible for that specific action.
- **Use Services**: Delegate all database operations to a Service (e.g., `userService`, `stakeService`). The queue's job is orchestration, not data manipulation.
- **Use Agents**: Import Agents directly if the job involves running an AI task.

### 5. Logging
- **No Console Logs**: Always use `import { log } from '../lib/log'`.
- **Context**: Pass useful context objects to the logger (e.g., `log.info('Processing job', { jobId: job.id, userId })`).

## Usage in Services

To use this queue in a service:

\`\`\`typescript
import { addJob } from '../queues/my.queue';

// ... inside a service method
await addJob('job_type_one', { entityId: '123', action: 'process' });
\`\`\`
