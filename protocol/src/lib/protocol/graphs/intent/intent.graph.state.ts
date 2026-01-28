import { Annotation, MessagesAnnotation } from "@langchain/langgraph";
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
 * The Graph State using LangGraph Annotations.
 * This acts as the central bus for data flowing through our graph.
 */
export const IntentGraphState = Annotation.Root({
  // --- Inputs (Required at start) ---
  /**
   * The user's profile context (Identity, Narrative, etc.)
   */
  userProfile: Annotation<string>,

  /**
   * The formatted string of currently active intents.
   * Used for deduplication and reconciliation.
   */
  activeIntents: Annotation<string>,

  /**
   * Explicit input content (e.g., user message).
   * Optional - graph might run on implicit only.
   */
  inputContent: Annotation<string | undefined>,

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
});
