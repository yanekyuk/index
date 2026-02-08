import type { LoggerWithSource } from "../../../protocol.log";
import type { ChatGraphCompositeDatabase } from "../../../interfaces/database.interface";
import type { ChatGraphState, SubgraphResults } from "../chat.graph.state";
import { IndexGraphFactory } from "../../index/index.graph";

/**
 * Creates a fast-path intent query node that directly fetches active intents.
 * Avoids expensive LLM processing for simple "show me my intents" queries.
 */
export function createIntentQueryNode(
  database: ChatGraphCompositeDatabase,
  logger: LoggerWithSource
) {
  return async (state: typeof ChatGraphState.State) => {
    logger.info("🚀 Fast path: Fetching active intents (read-only)...");
    
    try {
      const activeIntents = await database.getActiveIntents(state.userId);
      
      logger.info("✅ Retrieved intents via fast path", {
        count: activeIntents.length,
        costSavings: "~10 LLM calls avoided"
      });
      
      // Format intents for response generator
      const formattedIntents = activeIntents.map(intent => ({
        id: intent.id,
        description: intent.payload,
        summary: intent.summary || undefined,
        createdAt: intent.createdAt
      }));
      
      const subgraphResults: SubgraphResults = {
        intent: {
          mode: 'query',
          intents: formattedIntents,
          count: formattedIntents.length
        }
      };
      
      return { subgraphResults };
    } catch (error) {
      logger.error("Query failed", {
        error: error instanceof Error ? error.message : String(error)
      });
      return {
        subgraphResults: {
          intent: {
            mode: 'query',
            intents: [],
            count: 0,
            error: 'Failed to fetch intents'
          }
        },
        error: "Intent query failed"
      };
    }
  };
}

/**
 * Creates an intent write node that processes create/update/delete operations.
 * Maps ChatGraphState to IntentGraphState and invokes the full intent processing pipeline.
 * 
 * Features:
 * - Handles confirmation resolution (uses extractedContext for short confirmations)
 * - Passes conversation context for anaphoric resolution
 * - Supports operation modes (create/update/delete)
 * - Auto-indexes created intents to user's indexes
 */
export function createIntentWriteNode(
  database: ChatGraphCompositeDatabase,
  intentGraph: any,
  logger: LoggerWithSource
) {
  return async (state: typeof ChatGraphState.State) => {
    const operationType = state.routingDecision?.operationType;
    const extractedContext = state.routingDecision?.extractedContext;
    
    logger.info("🎯 Starting intent processing", {
      operationType,
      hasRoutingDecision: !!state.routingDecision,
      hasExtractedContext: !!extractedContext,
      extractedContextPreview: extractedContext 
        ? `"${extractedContext.substring(0, 100)}..."` 
        : null
    });
    
    const lastMessage = state.messages[state.messages.length - 1];
    const userMessageRaw = lastMessage?.content?.toString() || "";
    
    // CRITICAL: Check if router provided extractedContext
    // If user is confirming (short message + extractedContext exists), use extractedContext
    // The router already analyzed conversation and extracted the intent - trust it!
    const isShortMessage = userMessageRaw.length < 50;
    const isLikelyConfirmation = /^(yes|yeah|yep|yup|sure|ok(ay)?|alright|right|correct|exactly|that'?s? (right|correct)|this is (right|correct)|go ahead|do it|create( it)?|confirm|affirm|absolutely)$/i.test(userMessageRaw.trim().replace(/[.!?]+$/, ''));
    
    // Use extractedContext if:
    // 1. It exists AND
    // 2. Message is short (<50 chars) AND likely a confirmation
    const shouldUseExtractedContext = extractedContext && isShortMessage && isLikelyConfirmation;
    
    const inputContent = shouldUseExtractedContext 
      ? extractedContext 
      : userMessageRaw;
    
    logger.info("📝 Input content decision", {
      userMessageRaw: `"${userMessageRaw}"`,
      userMessageLength: userMessageRaw.length,
      hasExtractedContext: !!extractedContext,
      isShortMessage,
      isLikelyConfirmation,
      shouldUseExtractedContext,
      finalInputContent: `"${inputContent.substring(0, 150)}..."`,
      reasoning: shouldUseExtractedContext 
        ? "Short confirmation detected - using extractedContext from router"
        : isShortMessage && extractedContext && !isLikelyConfirmation
          ? `Message too short but not a confirmation pattern. Raw message: "${userMessageRaw}"`
          : "Using raw user message as input"
    });
    
    // Extract conversation context (last 10 messages max for anaphoric resolution)
    // This enables the intent inferrer to resolve references like "that intent"
    const CONTEXT_MESSAGE_LIMIT = 10;
    const conversationContext = state.messages.length > 1
      ? state.messages.slice(-CONTEXT_MESSAGE_LIMIT)
      : undefined;
    
    logger.info("📜 Conversation context for intent graph", {
      contextMessagesCount: conversationContext?.length || 0,
      hasContext: !!conversationContext,
      recentMessages: conversationContext?.slice(-3).map(m => ({
        role: m._getType(),
        preview: typeof m.content === 'string' ? m.content.substring(0, 80) : '[non-string]'
      }))
    });
    
    try {
      // Phase 4: Map operationType to operationMode
      // - delete → delete (skip inference & verification)
      // - update → update (skip verification for no new intents)
      // - create or undefined → create (full pipeline)
      const operationMode: 'create' | 'update' | 'delete' =
        operationType === 'delete' ? 'delete' :
        operationType === 'update' ? 'update' :
        'create';
      
      logger.info("🔀 Mapped operation type", {
        operationType,
        operationMode,
        expectedPath: operationMode === 'delete' ? 'prep → reconciliation → execution' :
                     operationMode === 'update' ? 'prep → inference → reconciliation → execution' :
                     'prep → inference → verification → reconciliation → execution'
      });
      
      // When index-scoped, fetch intents in this index and pass so the graph does not load from DB.
      let activeIntentsPreFetched: Array<{ id: string; payload: string; summary: string | null; createdAt: Date }> | undefined;
      if (state.indexId) {
        activeIntentsPreFetched = await database.getIntentsInIndexForMember(state.userId, state.indexId);
      }

      // Map ChatGraphState to IntentGraphState input
      const intentInput = {
        userId: state.userId,
        userProfile: state.userProfile
          ? JSON.stringify(state.userProfile)
          : "",
        inputContent,
        conversationContext,  // Phase 5: Pass conversation history for anaphoric resolution
        operationMode,  // Phase 4: Pass operation mode to control graph flow
        targetIntentIds: undefined,  // TODO: Extract from routing decision if needed
        ...(state.indexId ? { indexId: state.indexId } : {}),
        ...(activeIntentsPreFetched !== undefined ? { activeIntentsPreFetched } : {}),
      };

      logger.info("🚀 Invoking intent graph with input", {
        userId: intentInput.userId,
        hasUserProfile: !!intentInput.userProfile,
        inputContentLength: inputContent.length,
        inputContentPreview: `"${inputContent.substring(0, 150)}..."`,
        operationMode,
        hasConversationContext: !!conversationContext,
        indexId: state.indexId,
        preFetchedCount: activeIntentsPreFetched?.length
      });

      const result = await intentGraph.invoke(intentInput);

      if (result.requiredMessage) {
        logger.info("Intent graph returned requiredMessage (early exit)", { requiredMessage: result.requiredMessage });
        return {
          subgraphResults: {
            intent: {
              actions: [],
              inferredIntents: [],
              indexingResults: [],
              requiredMessage: result.requiredMessage,
            },
          },
        };
      }

      logger.info("✅ Intent graph complete", {
        operationMode,
        actionsCount: result.actions?.length || 0,
        inferredCount: result.inferredIntents?.length || 0,
        actions: result.actions?.map((a: any) => ({
          type: a.type,
          payload: 'payload' in a ? a.payload?.substring(0, 50) : undefined,
          id: 'id' in a ? a.id : undefined
        })),
        inferredIntents: result.inferredIntents?.map((i: any) =>
          typeof i === 'string' ? i.substring(0, 50) : i.description?.substring(0, 50)
        )
      });

      // Index created intents in user's auto-assign indexes
      const createdIntentIds = (result.executionResults || [])
        .filter(
          (r: { actionType: string; success: boolean; intentId?: string }) =>
            r.actionType === 'create' && r.success && r.intentId
        )
        .map((r: { actionType: string; success: boolean; intentId?: string }) => r.intentId as string);

      let indexingResults: Array<{
        intentId: string;
        indexId: string;
        assigned: boolean;
        success: boolean;
        error?: string;
      }> = [];

      if (createdIntentIds.length > 0) {
        const indexIds = await database.getUserIndexIds(state.userId);

        if (indexIds.length > 0) {
          const indexGraph = new IndexGraphFactory(database).createGraph();

          const results = await Promise.all(
            createdIntentIds.flatMap((intentId: string) =>
              indexIds.map(async (indexId: string) => {
                try {
                  const indexResult = await indexGraph.invoke({
                    intentId,
                    indexId
                  });
                  return {
                    intentId,
                    indexId,
                    assigned: indexResult.assignmentResult?.assigned ?? false,
                    success: indexResult.assignmentResult?.success ?? false,
                    error: indexResult.assignmentResult?.error
                  };
                } catch (error) {
                  logger.error("Index graph failed", {
                    intentId,
                    indexId,
                    error: error instanceof Error ? error.message : String(error)
                  });
                  return {
                    intentId,
                    indexId,
                    assigned: false,
                    success: false,
                    error: error instanceof Error ? error.message : String(error)
                  };
                }
              })
            )
          );

          indexingResults = results;

          logger.info("Indexing complete", {
            intentCount: createdIntentIds.length,
            indexCount: indexIds.length,
            assignedCount: results.filter(r => r.assigned).length
          });
        }
      }

      const subgraphResults: SubgraphResults = {
        intent: {
          actions: result.actions || [],
          inferredIntents: (result.inferredIntents || []).map(
            (i: { description: string }) => i.description
          ),
          indexingResults
        }
      };

      return { subgraphResults };
    } catch (error) {
      logger.error("❌ Processing failed", {
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
        operationType
      });
      return {
        subgraphResults: {
          intent: { actions: [], inferredIntents: [], indexingResults: [] }
        },
        error: "Intent processing failed"
      };
    }
  };
}
