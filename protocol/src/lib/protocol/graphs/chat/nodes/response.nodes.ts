import { ChatOpenAI } from "@langchain/openai";
import { AIMessage, BaseMessage, HumanMessage, SystemMessage } from "@langchain/core/messages";
import type { LoggerWithSource } from "../../../../log";
import type { ChatGraphState, SubgraphResults, RoutingDecision } from "../chat.graph.state";

/** Interface for response generator used by the response node (getSystemPrompt, buildUserPrompt, getSuggestedActions). */
export interface ResponseGeneratorAgent {
  getSystemPrompt(): string;
  buildUserPrompt(userMessage: string, routingDecision: RoutingDecision, subgraphResults: SubgraphResults): string;
  getSuggestedActions?(responseText: string, routingDecision: RoutingDecision): Promise<string[]>;
}

/**
 * Creates a response generation node that synthesizes final responses using streaming LLM.
 * Includes conversation history and subgraph results context.
 */
export function createGenerateResponseNode(
  responseGenerator: ResponseGeneratorAgent,
  logger: LoggerWithSource
) {
  return async (state: typeof ChatGraphState.State) => {
    const lastMessage = state.messages[state.messages.length - 1];
    const userMessage = lastMessage?.content?.toString() || "";

    logger.info("💬 Starting response generation", {
      messageCount: state.messages.length,
      userMessage: `"${userMessage}"`,
      hasRoutingDecision: !!state.routingDecision,
      hasSubgraphResults: !!state.subgraphResults
    });

    if (!state.routingDecision) {
      logger.error("❌ No routing decision available");
      const errorResponse = "I'm sorry, I couldn't process your request. Please try again.";
      return {
        responseText: errorResponse,
        messages: [new AIMessage(errorResponse)]
      };
    }
    
    logger.info("📊 Subgraph results summary", {
      hasIntentResults: !!state.subgraphResults?.intent,
      intentActionsCount: state.subgraphResults?.intent?.actions?.length || 0,
      intentInferredCount: state.subgraphResults?.intent?.inferredIntents?.length || 0,
      intentActions: state.subgraphResults?.intent?.actions?.map((a: { type: string; payload?: string }) => ({
        type: a.type,
        payload: 'payload' in a ? a.payload?.substring(0, 50) : undefined
      })),
      hasProfileResults: !!state.subgraphResults?.profile,
      hasOpportunityResults: !!state.subgraphResults?.opportunity,
      hasScrapeResults: !!state.subgraphResults?.scrape
    });

    try {
      // Create streaming-enabled ChatOpenAI instance
      // IMPORTANT: Do NOT use .withStructuredOutput() here - it buffers the entire response
      // and prevents streaming tokens from being emitted
      const streamingModel = new ChatOpenAI({
        model: 'google/gemini-2.5-flash',
        streaming: true,
        configuration: {
          baseURL: process.env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1',
          apiKey: process.env.OPENROUTER_API_KEY
        }
      });

      // Build prompt using ResponseGeneratorAgent's helper methods
      const systemPrompt = responseGenerator.getSystemPrompt();
      const userPrompt = responseGenerator.buildUserPrompt(
        userMessage,
        state.routingDecision,
        state.subgraphResults || {}
      );

      logger.info("📝 Built prompts for LLM", {
        systemPromptLength: systemPrompt.length,
        userPromptLength: userPrompt.length,
        userPromptPreview: userPrompt.substring(0, 500),
        routingTarget: state.routingDecision.target,
        routingOperationType: state.routingDecision.operationType
      });

      // Build messages array with conversation history
      // 1. System prompt
      // 2. Previous conversation messages (user/assistant pairs)
      // 3. Final structured prompt with routing context
      const messages: BaseMessage[] = [
        new SystemMessage(systemPrompt)
      ];

      // Add conversation history (excluding the last message since we'll add it with structured context)
      if (state.messages.length > 1) {
        // Include all previous conversation messages except the last one
        messages.push(...state.messages.slice(0, -1));
        
        logger.info("📜 Including conversation history", {
          historyMessageCount: state.messages.length - 1,
          recentHistory: state.messages.slice(-3, -1).map(m => ({
            role: m._getType(),
            preview: typeof m.content === 'string' ? m.content.substring(0, 80) : '[non-string]'
          }))
        });
      }

      // Add the final user message with structured prompt context
      messages.push(new HumanMessage(userPrompt));

      logger.info("🚀 Invoking streaming model", {
        totalMessages: messages.length,
        historyIncluded: state.messages.length > 1,
        finalUserPromptLength: userPrompt.length
      });

      // Invoke with streaming enabled
      // LangGraph's streamEvents() will capture `on_chat_model_stream` events from this model
      const response = await streamingModel.invoke(messages);

      // Extract the response content
      const responseText = typeof response.content === 'string'
        ? response.content
        : JSON.stringify(response.content);

      logger.info("✅ Streaming response complete", {
        responseLength: responseText.length,
        responsePreview: responseText.substring(0, 200)
      });

      // Get suggested actions separately (non-streaming, happens after main response)
      // This doesn't need to be streamed as it's supplementary data
      let suggestedActions: string[] = [];
      try {
        suggestedActions = responseGenerator.getSuggestedActions
          ? await responseGenerator.getSuggestedActions(responseText, state.routingDecision)
          : [];
        
        logger.info("💡 Suggested actions generated", {
          actionsCount: suggestedActions.length,
          actions: suggestedActions
        });
      } catch (actionsError) {
        logger.warn("⚠️ Failed to get suggested actions", {
          error: actionsError instanceof Error ? actionsError.message : String(actionsError)
        });
        // Continue without suggested actions - not critical
      }

      return {
        responseText,
        suggestedActions,
        messages: [new AIMessage(responseText)]
      };
    } catch (error) {
      logger.error("❌ Generation failed", {
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
        cause: error instanceof Error ? (error as any).cause : undefined
      });
      
      const fallbackResponse = "I apologize, but I encountered an issue. Could you please try again?";
      return {
        responseText: fallbackResponse,
        messages: [new AIMessage(fallbackResponse)],
        error: "Response generation failed"
      };
    }
  };
}

/**
 * Creates a direct response node that handles simple responses without subgraph processing.
 * Proceeds directly to response generation using routing decision context.
 */
export function createRespondDirectNode(logger: LoggerWithSource) {
  return async (state: typeof ChatGraphState.State) => {
    logger.info("Handling direct response...");
    
    // For simple responses, we proceed directly to response generation
    // The response generator will use the routing decision context
    return {};
  };
}

/**
 * Creates a clarification node that requests additional information from the user.
 * The response generator will craft an appropriate clarification question.
 */
export function createClarifyNode(logger: LoggerWithSource) {
  return async (state: typeof ChatGraphState.State) => {
    logger.info("Requesting clarification...");
    
    // Signal that clarification is needed
    // The response generator will craft an appropriate clarification question
    return {
      subgraphResults: {} as SubgraphResults
    };
  };
}
