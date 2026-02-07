import { Annotation } from "@langchain/langgraph";
import type { Id } from '../../../../types/common.types';
import type { OpportunityStatus, Opportunity } from '../../interfaces/database.interface';
import type { HydeStrategy } from '../../interfaces/embedder.interface';

/**
 * Opportunity Graph State (Linear Multi-Step Workflow)
 * 
 * Flow: Prep → Scope → Discovery → Evaluation → Ranking → Persist → END
 * 
 * Following the intent graph pattern with Annotation-based state management.
 */

/**
 * Indexed intent with hyde document (from prep node)
 */
export interface IndexedIntent {
  intentId: Id<'intents'>;
  payload: string;
  summary?: string;
  hydeDocumentId?: string;
  hydeEmbedding?: number[];
  indexes: Id<'indexes'>[];
}

/**
 * Target index for search (from scope node)
 */
export interface TargetIndex {
  indexId: Id<'indexes'>;
  title: string;
  memberCount: number;
}

/**
 * Candidate match from discovery (semantic search).
 * candidateIntentId is set for intent matches; omitted for profile-only matches.
 */
export interface CandidateMatch {
  candidateUserId: Id<'users'>;
  candidateIntentId?: Id<'intents'>;
  indexId: Id<'indexes'>;
  similarity: number;
  strategy: HydeStrategy;
  candidatePayload: string;
  candidateSummary?: string;
}

/**
 * Evaluated candidate with LLM scoring.
 * candidateIntentId is set for intent matches; omitted for profile-only matches.
 */
export interface EvaluatedCandidate {
  sourceUserId: Id<'users'>;
  candidateUserId: Id<'users'>;
  sourceIntentId?: Id<'intents'>;
  candidateIntentId?: Id<'intents'>;
  indexId: Id<'indexes'>;
  score: number; // 0-100
  sourceDescription: string; // Why source should meet candidate
  candidateDescription: string; // Why candidate should meet source
  valencyRole: 'Agent' | 'Patient' | 'Peer';
  strategy: HydeStrategy;
}

/**
 * Options passed to the graph
 */
export interface OpportunityGraphOptions {
  /** Initial status for created opportunities (default: 'pending') */
  initialStatus?: OpportunityStatus;
  /** Minimum score threshold (default: 70) */
  minScore?: number;
  /** Maximum opportunities to return (default: 10) */
  limit?: number;
  /** HyDE strategies to use (inferred if not provided) */
  strategies?: HydeStrategy[];
  /** User's search query for HyDE generation */
  hydeDescription?: string;
}

/**
 * Opportunity Graph State Annotation
 */
export const OpportunityGraphState = Annotation.Root({
  // ─── Input Fields (Required) ───
  userId: Annotation<Id<'users'>>({
    reducer: (curr, next) => next ?? curr,
    default: () => '' as Id<'users'>,
  }),
  
  searchQuery: Annotation<string | undefined>({
    reducer: (curr, next) => next ?? curr,
    default: () => undefined,
  }),
  
  indexId: Annotation<Id<'indexes'> | undefined>({
    reducer: (curr, next) => next ?? curr,
    default: () => undefined,
  }),
  
  options: Annotation<OpportunityGraphOptions>({
    reducer: (curr, next) => next ?? curr,
    default: () => ({}),
  }),
  
  // ─── Intermediate Fields (Accumulated) ───
  
  /** User's indexed intents with hyde documents (from prep) */
  indexedIntents: Annotation<IndexedIntent[]>({
    reducer: (curr, next) => next ?? curr,
    default: () => [],
  }),
  
  /** User's index memberships (from prep) */
  userIndexes: Annotation<Id<'indexes'>[]>({
    reducer: (curr, next) => next ?? curr,
    default: () => [],
  }),
  
  /** Target indexes to search within (from scope) */
  targetIndexes: Annotation<TargetIndex[]>({
    reducer: (curr, next) => next ?? curr,
    default: () => [],
  }),
  
  /** HyDE embeddings per strategy (from discovery) */
  hydeEmbeddings: Annotation<Record<HydeStrategy, number[]>>({
    reducer: (curr, next) => next ?? curr,
    default: () => ({} as Record<HydeStrategy, number[]>),
  }),
  
  /** Candidate matches from semantic search (from discovery) */
  candidates: Annotation<CandidateMatch[]>({
    reducer: (curr, next) => next ?? curr,
    default: () => [],
  }),
  
  /** Evaluated candidates with scores (from evaluation) */
  evaluatedCandidates: Annotation<EvaluatedCandidate[]>({
    reducer: (curr, next) => next ?? curr,
    default: () => [],
  }),
  
  // ─── Output Fields (Overwrite per turn) ───
  
  /** Final ranked and persisted opportunities */
  opportunities: Annotation<Opportunity[]>({
    reducer: (curr, next) => next,
    default: () => [],
  }),
  
  /** Error message if any step fails */
  error: Annotation<string | undefined>({
    reducer: (curr, next) => next,
    default: () => undefined,
  }),
});
