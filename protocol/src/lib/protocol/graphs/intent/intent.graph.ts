import { StateGraph, START, END } from "@langchain/langgraph";
import { IntentGraphState, VerifiedIntent } from "./intent.graph.state";
import { ExplicitIntentInferrer } from "../../agents/intent/inferrer/explicit.inferrer";
import { SemanticVerifierAgent } from "../../agents/intent/verifier/semantic.verifier";
import { IntentReconcilerAgent } from "../../agents/intent/reconciler/intent.reconciler";
import { log } from "../../../log";
import { Database } from "../../interfaces/database.interface";
import { Embedder } from "../../interfaces/embedder.interface";

/**
 * Factory class to build and compile the Intent Processing Graph.
 * We use a factory to inject dependencies (DB, Embedder) into the nodes.
 */
export class IntentGraphFactory {
  constructor(
    private database: Database,
    private embedder: Embedder
  ) { }

  public createGraph() {
    // Instantiate Agents (Nodes)
    const inferrer = new ExplicitIntentInferrer(this.database, this.embedder);
    const verifier = new SemanticVerifierAgent(this.database, this.embedder);
    const reconciler = new IntentReconcilerAgent(this.database, this.embedder);

    // --- NODE DEFINITIONS ---

    /**
     * Node 1: Inference
     * Extracts intents from raw content.
     */
    const inferenceNode = async (state: typeof IntentGraphState.State) => {
      log.info("[Graph:Inference] Starting inference...");
      // If we extracted 'inferredIntents' from explicit content
      const result = await inferrer.invoke(state.inputContent || null, state.userProfile);
      return { inferredIntents: result.intents };
    };

    /**
     * Node 2: Verification (Map-Reduce / Parallel)
     * Verifies each inferred intent in parallel.
     */
    const verificationNode = async (state: typeof IntentGraphState.State) => {
      const intents = state.inferredIntents;
      if (intents.length === 0) {
        return { verifiedIntents: [] };
      }

      log.info(`[Graph:Verification] Verifying ${intents.length} intents in parallel...`);

      // Parallel Execution
      const verificationResults = await Promise.all(
        intents.map(async (intent): Promise<VerifiedIntent | null> => {
          try {
            const verdict = await verifier.invoke(intent.description, state.userProfile);

            // Filter Logic: Must be a Commissive, Directive, or Declaration
            const VALID_TYPES = ['COMMISSIVE', 'DIRECTIVE', 'DECLARATION'];
            if (!VALID_TYPES.includes(verdict.classification)) {
              log.warn(`[Graph:Verification] Dropping intent: "${intent.description}" (Type: ${verdict.classification})`);
              return null;
            }

            // Calculate Score
            const score = Math.min(
              verdict.felicity_scores.authority,
              verdict.felicity_scores.sincerity,
              verdict.felicity_scores.clarity
            );

            // Return enriched intent
            return {
              ...intent,
              verification: verdict,
              score
            };
          } catch (e) {
            log.error(`[Graph:Verification] Error verifying intent: ${intent.description}`, { error: e });
            return null;
          }
        })
      );

      // Filter out nulls
      const verified = verificationResults.filter((i): i is VerifiedIntent => i !== null);
      log.info(`[Graph:Verification] ${verified.length}/${intents.length} passed verification.`);

      return { verifiedIntents: verified };
    };

    /**
     * Node 3: Reconciliation
     * Decides on final actions (Create, Update, Expire).
     */
    const reconciliationNode = async (state: typeof IntentGraphState.State) => {
      const candidates = state.verifiedIntents;
      if (candidates.length === 0) {
        return { actions: [] };
      }

      // Format candidates for the Reconciler Prompt
      // We assume the Reconciler expects a specific markdown format
      const formattedCandidates = candidates.map(c =>
        `- [${c.type.toUpperCase()}] "${c.description}" (Confidence: ${c.confidence}, Score: ${c.score})\n` +
        `  Reasoning: ${c.reasoning}\n` +
        `  Verification: ${c.verification?.classification} (Flags: ${c.verification?.flags.join(', ') || 'None'})`
      ).join('\n');

      const result = await reconciler.invoke(formattedCandidates, state.activeIntents);
      return { actions: result.actions };
    };

    // --- GRAPH ASSEMBLY ---

    const workflow = new StateGraph(IntentGraphState)
      .addNode("inference", inferenceNode)
      .addNode("verification", verificationNode)
      .addNode("reconciler", reconciliationNode)

      // Define Flow
      .addEdge(START, "inference")

      // Conditional Edge: If no intents found, stop early? 
      // For simplicity, we just flow to verification, which handles empty list gracefully.
      .addEdge("inference", "verification")

      .addEdge("verification", "reconciler")
      .addEdge("reconciler", END);

    return workflow.compile();
  }
}
