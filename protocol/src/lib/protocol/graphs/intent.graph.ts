import { StateGraph, START, END } from "@langchain/langgraph";
import { IntentGraphState, VerifiedIntent, ExecutionResult } from "../states/intent.state";
import { ExplicitIntentInferrer } from "../agents/intent.inferrer";
import { SemanticVerifier } from "../agents/intent.verifier";
import { IntentReconciler } from "../agents/intent.reconciler";
import { IntentGraphDatabase } from "../interfaces/database.interface";
import type { EmbeddingGenerator } from "../interfaces/embedder.interface";
import { protocolLogger } from "../support/protocol.logger";
import { addIntentHydeJob } from "../../../queues/intent-hyde.queue";

const logger = protocolLogger("IntentGraphFactory");

/**
 * Factory class to build and compile the Intent Processing Graph.
 */
export class IntentGraphFactory {
  constructor(
    private database: IntentGraphDatabase,
    private embedder?: EmbeddingGenerator,
  ) { }

  public createGraph() {
    // Instantiate Agents (Nodes)
    const inferrer = new ExplicitIntentInferrer();
    const verifier = new SemanticVerifier();
    const reconciler = new IntentReconciler();

    // --- NODE DEFINITIONS ---

    /**
     * Node 0: Prep
     * Always fetches ALL of the user's active intents from the DB via getActiveIntents(userId).
     * This ensures reconciliation can detect duplicates and modifications globally,
     * regardless of index scope.
     */
    const prepNode = async (state: typeof IntentGraphState.State) => {
      logger.info("Starting preparation phase", {
        operationMode: state.operationMode,
        hasContent: !!state.inputContent,
        targetIntentIds: state.targetIntentIds,
        indexId: state.indexId,
      });

      // Gate: write operations require an existing profile
      if (state.operationMode !== 'read') {
        const profile = await this.database.getProfile(state.userId);
        if (!profile) {
          throw new Error(
            "You need to create a profile before creating intents. Please set up your profile first."
          );
        }
      }

      const activeIntents = await this.database.getActiveIntents(state.userId);
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
      
      // Cast operationMode to exclude 'read' (inference node is never called in read mode)
      const inferrerMode = state.operationMode === 'read' ? 'create' : state.operationMode;
      const result = await inferrer.invoke(
        state.inputContent || null,
        state.userProfile,
        {
          allowProfileFallback,
          operationMode: inferrerMode,
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

            // Generate embedding for the intent payload
            let flatEmbedding: number[] | undefined;
            if (this.embedder) {
              try {
                const embedding = await this.embedder.generate(sanitizedPayload);
                flatEmbedding = Array.isArray(embedding?.[0])
                  ? (embedding as number[][])[0]
                  : (embedding as number[]);
                logger.info("Generated embedding for new intent", { dimensions: flatEmbedding?.length });
              } catch (embErr) {
                logger.error("Failed to generate embedding for intent (continuing without)", { error: embErr });
              }
            }

            const created = await this.database.createIntent({
              userId: state.userId,
              payload: sanitizedPayload,
              confidence: action.score ? action.score / 100 : 1.0,
              inferenceType: 'explicit',
              sourceType: 'discovery_form',
              embedding: flatEmbedding,
            });

            results.push({ actionType: 'create', success: true, intentId: created.id, payload: sanitizedPayload });
            logger.info(`Created intent: ${created.id}`);
            addIntentHydeJob('generate_hyde', { intentId: created.id, userId: state.userId }).catch((err) =>
              logger.error('Failed to enqueue intent HyDE job', { intentId: created.id, error: err })
            );

          } else if (action.type === 'update') {
            const sanitizedPayload = sanitizePayload(action.payload);

            // Regenerate embedding for the updated payload
            let flatEmbedding: number[] | undefined;
            if (this.embedder) {
              try {
                const embedding = await this.embedder.generate(sanitizedPayload);
                flatEmbedding = Array.isArray(embedding?.[0])
                  ? (embedding as number[][])[0]
                  : (embedding as number[]);
                logger.info("Generated embedding for updated intent", { intentId: action.id, dimensions: flatEmbedding?.length });
              } catch (embErr) {
                logger.error("Failed to generate embedding for intent update (continuing without)", { error: embErr });
              }
            }

            const updated = await this.database.updateIntent(action.id, {
              payload: sanitizedPayload,
              embedding: flatEmbedding,
            });
            results.push({
              actionType: 'update',
              success: !!updated,
              intentId: action.id,
              payload: sanitizedPayload,
              error: updated ? undefined : 'Intent not found'
            });
            logger.info(`Updated intent: ${action.id}`);
            if (updated) {
              addIntentHydeJob('generate_hyde', { intentId: action.id, userId: state.userId }).catch((err) =>
                logger.error('Failed to enqueue intent HyDE job', { intentId: action.id, error: err })
              );
            }

          } else if (action.type === 'expire') {
            const result = await this.database.archiveIntent(action.id);
            results.push({
              actionType: 'expire',
              success: result.success,
              intentId: action.id,
              error: result.error
            });
            logger.info(`Archived intent: ${action.id}`);
            if (result.success) {
              addIntentHydeJob('delete_hyde', { intentId: action.id }).catch((err) =>
                logger.error('Failed to enqueue intent HyDE delete job', { intentId: action.id, error: err })
              );
            }
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

    // --- QUERY NODE (Read Mode) ---

    /**
     * Node: Query
     * Fast-path read node — fetches intents from DB based on scope.
     * Handles: global user intents, index-scoped (all or filtered by user).
     * No LLM calls; no inference/verification/reconciliation.
     */
    const queryNode = async (state: typeof IntentGraphState.State) => {
      logger.info("Starting query (read mode)", {
        userId: state.userId,
        indexId: state.indexId,
        queryUserId: state.queryUserId,
        allUserIntents: state.allUserIntents,
      });

      try {
        // When allUserIntents is true, ignore index scope and return all
        const effectiveIndexId = state.allUserIntents ? undefined : state.indexId;

        if (effectiveIndexId) {
          // Verify membership
          const isMember = await this.database.isIndexMember(effectiveIndexId, state.userId);
          if (!isMember) {
            return {
              readResult: {
                count: 0,
                intents: [],
                message: "Index not found or you are not a member.",
              },
            };
          }

          // Index-scoped read
          if (!state.queryUserId) {
            // All intents in the index (any member can see)
            const intents = await this.database.getIndexIntentsForMember(
              effectiveIndexId,
              state.userId,
              { limit: 50, offset: 0 }
            );
            if (intents.length === 0) {
              return {
                readResult: {
                  count: 0,
                  intents: [],
                  message: "No intents in this index yet.",
                  indexId: effectiveIndexId,
                },
              };
            }
            return {
              readResult: {
                count: intents.length,
                indexId: effectiveIndexId,
                intents: intents.map((i) => ({
                  id: i.id,
                  description: i.payload,
                  summary: i.summary,
                  createdAt: i.createdAt,
                  userId: i.userId,
                  userName: i.userName,
                })),
              },
            };
          }

          // Specific user's intents in the index
          const effectiveUserId = state.queryUserId;
          const intents = await this.database.getIntentsInIndexForMember(
            effectiveUserId,
            effectiveIndexId
          );
          if (intents.length === 0) {
            return {
              readResult: {
                count: 0,
                intents: [],
                message:
                  effectiveUserId === state.userId
                    ? "You don't have any intents in this index yet."
                    : "No intents for that user in this index.",
                indexId: effectiveIndexId,
              },
            };
          }
          const user = await this.database.getUser(effectiveUserId);
          const userName = user?.name ?? null;
          return {
            readResult: {
              count: intents.length,
              indexId: effectiveIndexId,
              intents: intents.map((i) => ({
                id: i.id,
                description: i.payload,
                summary: i.summary,
                createdAt: i.createdAt,
                userId: effectiveUserId,
                userName,
              })),
            },
          };
        }

        // Global (no index scope): return user's own active intents
        const intents = await this.database.getActiveIntents(state.userId);
        if (intents.length === 0) {
          return {
            readResult: {
              count: 0,
              intents: [],
              message:
                "You don't have any active intents yet. Share your goals or what you're looking for.",
            },
          };
        }
        return {
          readResult: {
            count: intents.length,
            intents: intents.map((i) => ({
              id: i.id,
              description: i.payload,
              summary: i.summary,
              createdAt: i.createdAt,
            })),
          },
        };
      } catch (err) {
        logger.error("Query node failed", { error: err });
        return {
          readResult: {
            count: 0,
            intents: [],
            message: "Failed to fetch intents. Please try again.",
          },
        };
      }
    };

    // --- CONDITIONAL ROUTING FUNCTIONS ---

    /**
     * After prep: read mode → query; otherwise decide inference vs reconciler by operation mode.
     */
    const afterPrepRoute = (state: typeof IntentGraphState.State): string => {
      if (state.operationMode === 'read') {
        logger.info('Read mode - routing to query (fast path)');
        return 'query';
      }
      return shouldRunInference(state);
    };
    
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
      .addNode("query", queryNode)
      .addNode("inference", inferenceNode)
      .addNode("verification", verificationNode)
      .addNode("reconciler", reconciliationNode)
      .addNode("executor", executorNode)

      // Flow paths:
      // - READ:    prep → query → END (fast path, no LLM calls)
      // - CREATE:  prep → inference → verification → reconciler → executor → END
      // - UPDATE:  prep → inference → reconciliation → executor → END (skips verification if no new intents)
      // - DELETE:  prep → reconciliation → executor → END (skips inference and verification)
      .addEdge(START, "prep")
      
      // After prep: read mode → query; else inference or reconciler
      .addConditionalEdges("prep", afterPrepRoute, {
        query: "query",
        inference: "inference",
        reconciler: "reconciler"
      })

      // Query (read mode) always ends
      .addEdge("query", END)
      
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
