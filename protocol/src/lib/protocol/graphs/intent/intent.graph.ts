import { StateGraph, START, END } from "@langchain/langgraph";
import { IntentGraphState, VerifiedIntent, ExecutionResult } from "./intent.graph.state";
import { ExplicitIntentInferrer } from "../../agents/intent/inferrer/explicit.inferrer";
import { SemanticVerifierAgent } from "../../agents/intent/verifier/semantic.verifier";
import { IntentReconcilerAgent } from "../../agents/intent/reconciler/intent.reconciler";
import { IntentGraphDatabase } from "../../interfaces/database.interface";
import { log } from "../../../log";

const logger = log.graph.from("intent.graph.ts");

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
      logger.info("Starting preparation phase", {
        operationMode: state.operationMode,
        hasContent: !!state.inputContent,
        targetIntentIds: state.targetIntentIds
      });
      
      const activeIntents = await this.database.getActiveIntents(state.userId);
      
      // Format for reconciler agent
      const formattedActiveIntents = activeIntents
        .map(i => `ID: ${i.id}, Description: ${i.payload}, Summary: ${i.summary || 'N/A'}`)
        .join('\n') || "No active intents.";
      
      logger.info("Fetched active intents", {
        count: activeIntents.length,
        operationMode: state.operationMode
      });
      
      return { activeIntents: formattedActiveIntents };
    };

    /**
     * Node 1: Inference
     * Extracts intents from raw content.
     * Phase 4: Uses operation mode to control behavior and determine if node should execute.
     * Phase 5: Passes conversation context for anaphoric resolution.
     */
    const inferenceNode = async (state: typeof IntentGraphState.State) => {
      logger.info("Starting inference", {
        operationMode: state.operationMode,
        hasContent: !!state.inputContent,
        contentPreview: state.inputContent?.substring(0, 50),
        hasConversationContext: !!state.conversationContext,
        conversationMessagesCount: state.conversationContext?.length || 0
      });
      
      // Phase 4: Control profile fallback based on operation mode
      // Only allow for create operations without explicit content
      const allowProfileFallback = state.operationMode === 'create' && !state.inputContent;
      
      const result = await inferrer.invoke(
        state.inputContent || null,
        state.userProfile,
        {
          allowProfileFallback,
          operationMode: state.operationMode,
          conversationContext: state.conversationContext  // Phase 5: Pass conversation history
        }
      );
      
      logger.info("Inference complete", {
        inferredCount: result.intents.length,
        operationMode: state.operationMode
      });
      
      return { inferredIntents: result.intents };
    };

    /**
     * Node 2: Verification (Map-Reduce / Parallel)
     * Verifies each inferred intent in parallel.
     * Phase 4: Can be skipped for delete operations and updates with no new intents.
     */
    const verificationNode = async (state: typeof IntentGraphState.State) => {
      const intents = state.inferredIntents;
      
      logger.info("Starting verification", {
        operationMode: state.operationMode,
        intentCount: intents.length
      });
      
      if (intents.length === 0) {
        logger.info("No intents to verify");
        return { verifiedIntents: [] };
      }

      logger.info(`Verifying ${intents.length} intents in parallel...`);

      // Parallel Execution
      const verificationResults = await Promise.all(
        intents.map(async (intent): Promise<VerifiedIntent | null> => {
          try {
            const verdict = await verifier.invoke(intent.description, state.userProfile);

            // Filter Logic: Must be a Commissive, Directive, or Declaration
            const VALID_TYPES = ['COMMISSIVE', 'DIRECTIVE', 'DECLARATION'];
            if (!VALID_TYPES.includes(verdict.classification)) {
              logger.warn(`Dropping intent: "${intent.description}" (Type: ${verdict.classification})`);
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
            logger.error(`Error verifying intent: ${intent.description}`, { error: e });
            return null;
          }
        })
      );

      // Filter out nulls
      const verified = verificationResults.filter((i): i is VerifiedIntent => i !== null);
      logger.info(`Verification complete`, {
        passed: verified.length,
        total: intents.length,
        operationMode: state.operationMode
      });

      return { verifiedIntents: verified };
    };

    /**
     * Node 3: Reconciliation
     * Decides on final actions (Create, Update, Expire).
     * Phase 4: Handles delete operations directly without LLM reconciliation.
     */
    const reconciliationNode = async (state: typeof IntentGraphState.State) => {
      logger.info("Starting reconciliation", {
        operationMode: state.operationMode,
        verifiedIntentCount: state.verifiedIntents.length,
        targetIntentIds: state.targetIntentIds
      });
      
      // Phase 4: Handle delete operations directly
      if (state.operationMode === 'delete') {
        if (!state.targetIntentIds || state.targetIntentIds.length === 0) {
          logger.warn("Delete mode with no target IDs");
          return { actions: [] };
        }
        
        logger.info("Delete mode - generating expire actions", {
          targetIds: state.targetIntentIds
        });
        
        const actions = state.targetIntentIds.map(id => ({
          type: 'expire' as const,
          id,
          reasoning: 'User requested deletion'
        }));
        
        return { actions };
      }
      
      // Standard reconciliation for create/update operations
      const candidates = state.verifiedIntents;
      if (candidates.length === 0) {
        logger.info("No verified intents to reconcile");
        return { actions: [] };
      }

      // Format candidates for the Reconciler Prompt
      const formattedCandidates = candidates.map(c =>
        `- [${c.type.toUpperCase()}] "${c.description}" (Confidence: ${c.confidence}, Score: ${c.score})\n` +
        `  Reasoning: ${c.reasoning}\n` +
        `  Verification: ${c.verification?.classification} (Flags: ${c.verification?.flags.join(', ') || 'None'})`
      ).join('\n');

      logger.info("Invoking reconciler agent", {
        candidateCount: candidates.length,
        operationMode: state.operationMode
      });

      const result = await reconciler.invoke(formattedCandidates, state.activeIntents);
      
      logger.info("Reconciliation complete", {
        actionCount: result.actions.length,
        operationMode: state.operationMode
      });
      
      return { actions: result.actions };
    };

    /** Strip URLs and "More details at [url]" from intent payloads before persisting. */
    const sanitizePayload = (payload: string): string => {
      if (!payload || typeof payload !== "string") return payload;
      let out = payload
        .replace(/\s*More details at\s*:?\s*https?:\/\/[^\s"'<>)\]]+/gi, "")
        .replace(/\s*See\s+https?:\/\/[^\s"'<>)\]]+\s+for\s+more[^.]*\.?/gi, "")
        .replace(/https?:\/\/[^\s"'<>)\]]+/g, "")
        .replace(/\s{2,}/g, " ")
        .trim();
      return out.replace(/[.,;]\s*$/, "").trim() || payload;
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

      logger.info(`Executing ${actions.length} actions...`);
      const results: ExecutionResult[] = [];

      for (const action of actions) {
        try {
          if (action.type === 'create') {
            const sanitizedPayload = sanitizePayload(action.payload);
            const created = await this.database.createIntent({
              userId: state.userId,
              payload: sanitizedPayload,
              confidence: action.score ? action.score / 100 : 1.0,
              inferenceType: 'explicit',
              sourceType: 'discovery_form'
            });
            results.push({ actionType: 'create', success: true, intentId: created.id, payload: sanitizedPayload });
            logger.info(`Created intent: ${created.id}`);
            
          } else if (action.type === 'update') {
            const sanitizedPayload = sanitizePayload(action.payload);
            const updated = await this.database.updateIntent(action.id, {
              payload: sanitizedPayload
            });
            results.push({
              actionType: 'update',
              success: !!updated,
              intentId: action.id,
              payload: sanitizedPayload,
              error: updated ? undefined : 'Intent not found'
            });
            logger.info(`Updated intent: ${action.id}`);
            
          } else if (action.type === 'expire') {
            const result = await this.database.archiveIntent(action.id);
            results.push({
              actionType: 'expire',
              success: result.success,
              intentId: action.id,
              error: result.error
            });
            logger.info(`Archived intent: ${action.id}`);
          }
        } catch (error) {
          logger.error(`Failed to execute ${action.type}:`, { error });
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

    // --- CONDITIONAL ROUTING FUNCTIONS ---
    
    /**
     * Determines if inference should run based on operation mode.
     * Delete operations skip inference entirely and go straight to reconciliation.
     */
    const shouldRunInference = (state: typeof IntentGraphState.State): string => {
      if (state.operationMode === 'delete') {
        logger.info('Delete mode - skipping inference, routing to reconciliation');
        return 'reconciler';
      }
      
      logger.info('Running inference', {
        operationMode: state.operationMode
      });
      return 'inference';
    };
    
    /**
     * Determines if verification should run based on operation mode and inferred intents.
     * Skips verification for:
     * - Operations with no inferred intents
     * - Can be extended to skip for update operations with no new intents
     */
    const shouldRunVerification = (state: typeof IntentGraphState.State): string => {
      if (state.inferredIntents.length === 0) {
        logger.info('No intents to verify - skipping verification, routing to reconciliation');
        return 'reconciler';
      }
      
      if (state.operationMode === 'update') {
        logger.info('Update mode with new intents - running verification');
        return 'verification';
      }
      
      if (state.operationMode === 'create') {
        logger.info('Create mode - running verification');
        return 'verification';
      }
      
      // Default to verification for safety
      logger.info('Default routing to verification');
      return 'verification';
    };

    // --- GRAPH ASSEMBLY WITH CONDITIONAL EDGES (PHASE 4) ---

    const workflow = new StateGraph(IntentGraphState)
      .addNode("prep", prepNode)
      .addNode("inference", inferenceNode)
      .addNode("verification", verificationNode)
      .addNode("reconciler", reconciliationNode)
      .addNode("executor", executorNode)

      // Phase 4: Conditional flow based on operation mode
      // Flow paths:
      // - CREATE:  prep → inference → verification → reconciler → executor → END
      // - UPDATE:  prep → inference → reconciliation → executor → END (skips verification if no new intents)
      // - DELETE:  prep → reconciliation → executor → END (skips inference and verification)
      .addEdge(START, "prep")
      
      // After prep: decide if we need inference (skip for delete)
      .addConditionalEdges("prep", shouldRunInference, {
        inference: "inference",
        reconciler: "reconciler"
      })
      
      // After inference: decide if we need verification (skip if no intents)
      .addConditionalEdges("inference", shouldRunVerification, {
        verification: "verification",
        reconciler: "reconciler"
      })
      
      // Verification always goes to reconciliation
      .addEdge("verification", "reconciler")
      
      // Reconciliation always goes to executor
      .addEdge("reconciler", "executor")
      
      // Executor is always the end
      .addEdge("executor", END);

    return workflow.compile();
  }
}
