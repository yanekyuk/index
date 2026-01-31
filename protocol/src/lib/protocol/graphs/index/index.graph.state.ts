import { Annotation } from "@langchain/langgraph";
import type { IntentIndexerOutput } from "../../agents/index/intent.indexer.types";

/**
 * Intent payload and metadata loaded for index evaluation.
 */
export interface IntentForIndexing {
  id: string;
  payload: string;
  userId: string;
  sourceType: string | null;
  sourceId: string | null;
}

/**
 * Index and member prompts for a single index (user must be member with autoAssign).
 */
export interface IndexMemberContext {
  indexId: string;
  indexPrompt: string | null;
  memberPrompt: string | null;
}

/**
 * Result of executing an assignment decision (assign or unassign).
 */
export interface AssignmentResult {
  indexId: string;
  assigned: boolean;
  success: boolean;
  error?: string;
}

/**
 * Index Graph State.
 * Evaluates intent appropriateness for a single index and applies assignment.
 *
 * Flow:
 * 1. prep – Load intent + index/member context (or skip if not eligible).
 * 2. evaluate – Call IntentIndexer (or auto-assign if no prompts).
 * 3. execute – Assign or unassign intent to index.
 */
export const IndexGraphState = Annotation.Root({
  // --- Inputs (Required at start) ---

  /** Intent to evaluate. */
  intentId: Annotation<string>,

  /** Index (community) to evaluate against. */
  indexId: Annotation<string>,

  // --- Populated by prep node ---

  /** Intent payload and metadata. Null if intent not found. */
  intent: Annotation<IntentForIndexing | null>({
    reducer: (_, next) => next,
    default: () => null,
  }),

  /** Index + member context. Null if user not eligible (not member or autoAssign false). */
  indexContext: Annotation<IndexMemberContext | null>({
    reducer: (_, next) => next,
    default: () => null,
  }),

  /** Whether intent is currently assigned to this index. */
  isCurrentlyAssigned: Annotation<boolean>({
    reducer: (_, next) => next,
    default: () => false,
  }),

  /** When true, skip LLM and auto-assign (no prompts). */
  skipEvaluation: Annotation<boolean>({
    reducer: (_, next) => next,
    default: () => false,
  }),

  // --- Populated by evaluate node ---

  /** LLM evaluation result. Null if skipped or evaluation failed. */
  evaluation: Annotation<IntentIndexerOutput | null>({
    reducer: (_, next) => next,
    default: () => null,
  }),

  /** Final decision: should intent be in this index? */
  shouldAssign: Annotation<boolean>({
    reducer: (_, next) => next,
    default: () => false,
  }),

  /** Final score used for decision (0–1). */
  finalScore: Annotation<number>({
    reducer: (_, next) => next,
    default: () => 0,
  }),

  // --- Output (Populated by execute node) ---

  /** Result of the assignment operation. */
  assignmentResult: Annotation<AssignmentResult | null>({
    reducer: (_, next) => next,
    default: () => null,
  }),

  /** Error message if graph could not complete (e.g. missing intent or context). */
  error: Annotation<string | null>({
    reducer: (_, next) => next,
    default: () => null,
  }),
});
