import type { Id } from '../../../../types/common.types';
import type { CandidateProfile, OpportunityEvaluatorOptions } from '../../agents/opportunity/opportunity.evaluator';
import type { HydeCandidate } from '../../interfaces/embedder.interface';
import type { Opportunity } from '../../interfaces/database.interface';

/**
 * The State of the Opportunity Matching Graph.
 *
 * Flow: resolve_source_profile → invoke_hyde → search_candidates → deduplicate
 *       → evaluate_candidates → persist_opportunities.
 *
 * Channels:
 * - options: Trace-scoped configuration (Read-Only).
 * - sourceProfileContext: The source user profile context (Read-Only).
 * - sourceUserId: The user we are finding opportunities for.
 * - hydeEmbeddings: Output from HyDE subgraph (strategy → embedding vector).
 * - candidates: HyDE search results (HydeCandidate[]) or pre-filled CandidateProfile[] for evaluate.
 * - opportunities: Persisted opportunities (new schema) after persist_opportunities.
 */
export interface OpportunityGraphState {
  // Config & Inputs
  options: OpportunityEvaluatorOptions;
  sourceProfileContext: string;
  sourceUserId: Id<'users'>;

  /** Intent or query used for HyDE (intent payload or ad-hoc query). */
  sourceText?: string;
  /** Intent ID when run from intent-triggered flow (for detection.triggeredBy and context). */
  intentId?: Id<'intents'>;
  /** Index scope for search (index IDs to restrict candidates). */
  indexScope: Id<'indexes'>[];

  // Intermediate State (HyDE → search → dedupe)
  /** HyDE embeddings per strategy from invoke_hyde node. */
  hydeEmbeddings: Record<string, number[]>;
  /** Candidates from HyDE search (HydeCandidate[]) or direct input (CandidateProfile[]). */
  candidates: HydeCandidate[] | CandidateProfile[];

  // Output State
  /** Persisted opportunities (new schema with detection, actors, interpretation, context). */
  opportunities: Opportunity[];
}

/**
 * Initial State Factory
 */
export function createInitialState(): OpportunityGraphState {
  return {
    options: {},
    sourceProfileContext: '',
    sourceUserId: '' as Id<'users'>,
    indexScope: [],
    hydeEmbeddings: {},
    candidates: [],
    opportunities: [],
  };
}
