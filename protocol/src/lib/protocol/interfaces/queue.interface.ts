/**
 * Queue types for protocol layer.
 * Re-exports from adapter so protocol stays decoupled from BullMQ; adapter owns the contract.
 */

export type {
  AddJobResult,
  IndexIntentJobData,
  GenerateIntentsJobData,
  IntentJobName,
  IntentJobData,
  IntentQueue,
  NewsletterCandidate,
  NewsletterJobData,
  WeeklyCycleJobData,
  NewsletterJobName,
  NewsletterJobDataUnion,
  NewsletterQueue,
  OpportunityJobData,
  OpportunityQueue,
  ProfileUpdateJobData,
  ProfileQueue,
  QueueAdapter,
  QueueAdapterDeps,
  AddJobOptionsFn,
} from '../../../adapters/queue.adapter';
