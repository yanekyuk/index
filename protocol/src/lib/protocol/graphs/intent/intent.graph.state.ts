import { Annotation, MessagesAnnotation } from "@langchain/langgraph";
import { BaseMessage } from "@langchain/core/messages";
import { InferredIntent } from "../../agents/intent/inferrer/explicit.inferrer";
import { SemanticVerifierOutput } from "../../agents/intent/verifier/semantic.verifier";
import { IntentReconcilerOutput } from "../../agents/intent/reconciler/intent.reconciler";

/**
 * Extended InferredIntent that includes verification results.
 * We attach the verification output directly to the intent object
 * as it flows through the graph.
 */
export type VerifiedIntent = InferredIntent & {
  verification?: SemanticVerifierOutput;
  score?: number; // Calculated min(authority, sincerity, clarity)
};

/**
 * Result of executing a single reconciler action.
 */
export interface ExecutionResult {
  /** The action type that was executed */
  actionType: 'create' | 'update' | 'expire';
  /** Whether the action succeeded */
  success: boolean;
  /** The intent ID (created/updated/archived) */
  intentId?: string;
  /** Final payload (sanitized, for create/update) */
  payload?: string;
  /** Error message if failed */
  error?: string;
}

/**
 * The Graph State using LangGraph Annotations.
 * This acts as the central bus for data flowing through our graph.
 */
export const IntentGraphState = Annotation.Root({
  // --- Inputs (Required at start) ---

  /**
   * The unique identifier of the user whose intents are being processed.
   * Required for database operations.
   */
  userId: Annotation<string>,

  /**
   * The user's profile context (Identity, Narrative, etc.)
   */
  userProfile: Annotation<string>,

  /**
   * Explicit input content (e.g., user message).
   * Optional - graph might run on implicit only.
   */
  inputContent: Annotation<string | undefined>,

  /**
   * Conversation history for context-aware intent inference.
   * Used to resolve anaphoric references ("that intent", "this goal").
   * Limited to recent messages (typically last 10) for token efficiency.
   * Optional - if not provided, intent inference uses only inputContent.
   */
  conversationContext: Annotation<BaseMessage[] | undefined>({
    reducer: (curr, next) => next ?? curr,
    default: () => undefined,
  }),

  /**
   * Operation mode controls graph flow and determines which nodes execute.
   * - 'create': Full pipeline (prep → inference → verification → reconciliation → execution)
   * - 'update': Skip verification if no new intents (prep → inference → reconciliation → execution)
   * - 'delete': Skip inference and verification (prep → reconciliation → execution)
   *
   * Defaults to 'create' for backward compatibility.
   */
  operationMode: Annotation<'create' | 'update' | 'delete'>({
    reducer: (curr, next) => next ?? curr,
    default: () => 'create' as const,
  }),

  /**
   * For update/delete operations, specifies which intent IDs to target.
   * Optional - used when modifying or removing specific intents.
   */
  targetIntentIds: Annotation<string[] | undefined>({
    reducer: (curr, next) => next ?? curr,
    default: () => undefined,
  }),

  // --- Populated by Graph (Prep Node) ---

  /**
   * The formatted string of currently active intents.
   * Populated by prepNode from database.getActiveIntents().
   */
  activeIntents: Annotation<string>({
    reducer: (curr, next) => next,
    default: () => "",
  }),

  // --- Intermediate State ---

  /**
   * List of raw intents extracted from text.
   */
  inferredIntents: Annotation<InferredIntent[]>({
    reducer: (curr, next) => next, // Overwrite with new inference
    default: () => [],
  }),

  /**
   * List of intents that have passed semantic verification.
   * Invalid intents are filtered out before reaching this state.
   */
  verifiedIntents: Annotation<VerifiedIntent[]>({
    reducer: (curr, next) => next,
    default: () => [],
  }),

  // --- Output ---

  /**
   * Final actions to be performed on the DB (Create, Update, Expire).
   */
  actions: Annotation<IntentReconcilerOutput['actions']>({
    reducer: (curr, next) => next,
    default: () => [],
  }),

  /**
   * Results of executing actions against the database.
   * Populated by executorNode after actions are persisted.
   */
  executionResults: Annotation<ExecutionResult[]>({
    reducer: (curr, next) => next,
    default: () => [],
  }),
});
