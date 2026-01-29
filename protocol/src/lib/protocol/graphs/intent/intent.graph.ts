import { StateGraph, START, END } from "@langchain/langgraph";
import { IntentGraphState, VerifiedIntent, ExecutionResult } from "./intent.graph.state";
import { ExplicitIntentInferrer } from "../../agents/intent/inferrer/explicit.inferrer";
import { SemanticVerifierAgent } from "../../agents/intent/verifier/semantic.verifier";
import { IntentReconcilerAgent } from "../../agents/intent/reconciler/intent.reconciler";
import { IntentGraphDatabase } from "../../interfaces/database.interface";
import { log } from "../../../log";

/**
 * Factory class to build and compile the Intent Processing Graph.
 */
export class IntentGraphFactory {
  constructor(private database: IntentGraphDatabase) { }

  public createGraph() {
    // Instantiate Agents (Nodes)
    const inferrer = new ExplicitIntentInferrer();
    const verifier = new SemanticVerifierAgent();
    const reconciler = new IntentReconcilerAgent();

    // --- NODE DEFINITIONS ---

    /**
     * Node 0: Prep
     * Fetches active intents from database for reconciliation context.
     */
    const prepNode = async (state: typeof IntentGraphState.State) => {
      log.info("[Graph:Prep] Fetching active intents for reconciliation context...");
      const activeIntents = await this.database.getActiveIntents(state.userId);
      
      // Format for reconciler agent
      const formattedActiveIntents = activeIntents
        .map(i => `ID: ${i.id}, Description: ${i.payload}, Summary: ${i.summary || 'N/A'}`)
        .join('\n') || "No active intents.";
      
      return { activeIntents: formattedActiveIntents };
    };

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

    /**
     * Node 4: Executor
     * Executes reconciler actions against the database.
     */
    const executorNode = async (state: typeof IntentGraphState.State) => {
      const actions = state.actions;
      if (!actions || actions.length === 0) {
        return { executionResults: [] };
      }

      log.info(`[Graph:Executor] Executing ${actions.length} actions...`);
      const results: ExecutionResult[] = [];

      for (const action of actions) {
        try {
          if (action.type === 'create') {
            const created = await this.database.createIntent({
              userId: state.userId,
              payload: action.payload,
              confidence: action.score ? action.score / 100 : 1.0,
              inferenceType: 'explicit',
              sourceType: 'discovery_form'
            });
            results.push({ actionType: 'create', success: true, intentId: created.id });
            log.info(`[Graph:Executor] Created intent: ${created.id}`);
            
          } else if (action.type === 'update') {
            const updated = await this.database.updateIntent(action.id, {
              payload: action.payload
            });
            results.push({
              actionType: 'update',
              success: !!updated,
              intentId: action.id,
              error: updated ? undefined : 'Intent not found'
            });
            log.info(`[Graph:Executor] Updated intent: ${action.id}`);
            
          } else if (action.type === 'expire') {
            const result = await this.database.archiveIntent(action.id);
            results.push({
              actionType: 'expire',
              success: result.success,
              intentId: action.id,
              error: result.error
            });
            log.info(`[Graph:Executor] Archived intent: ${action.id}`);
          }
        } catch (error) {
          log.error(`[Graph:Executor] Failed to execute ${action.type}:`, { error });
          results.push({
            actionType: action.type,
            success: false,
            intentId: 'id' in action ? action.id : undefined,
            error: error instanceof Error ? error.message : 'Unknown error'
          });
        }
      }

      return { executionResults: results };
    };

    // --- GRAPH ASSEMBLY ---

    const workflow = new StateGraph(IntentGraphState)
      .addNode("prep", prepNode)
      .addNode("inference", inferenceNode)
      .addNode("verification", verificationNode)
      .addNode("reconciler", reconciliationNode)
      .addNode("executor", executorNode)

      // Define Flow
      .addEdge(START, "prep")
      .addEdge("prep", "inference")
      .addEdge("inference", "verification")
      .addEdge("verification", "reconciler")
      .addEdge("reconciler", "executor")
      .addEdge("executor", END);

    return workflow.compile();
  }
}
