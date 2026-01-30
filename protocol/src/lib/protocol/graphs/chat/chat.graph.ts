import { StateGraph, START, END, MemorySaver } from "@langchain/langgraph";
import { PostgresSaver } from "@langchain/langgraph-checkpoint-postgres";
import { ChatOpenAI } from "@langchain/openai";
import { AIMessage, BaseMessage, HumanMessage, SystemMessage, isAIMessageChunk } from "@langchain/core/messages";
import { ChatGraphState, RoutingDecision, SubgraphResults } from "./chat.graph.state";
import { RouterAgent, RouteTarget } from "../../agents/chat/router.agent";
import { ResponseGeneratorAgent, RESPONSE_GENERATOR_SYSTEM_PROMPT } from "../../agents/chat/response.generator";
import { IntentGraphFactory } from "../intent/intent.graph";
import { ProfileGraphFactory } from "../profile/profile.graph";
import { OpportunityGraph } from "../opportunity/opportunity.graph";
import type { ChatGraphCompositeDatabase } from "../../interfaces/database.interface";
import type { Embedder } from "../../interfaces/embedder.interface";
import type { Scraper } from "../../interfaces/scraper.interface";
import { log } from "../../../log";
import type { ChatStreamEvent } from "../../../../types/chat-streaming";
import {
  createStatusEvent,
  createRoutingEvent,
  createSubgraphStartEvent,
  createSubgraphResultEvent,
  createTokenEvent,
  createErrorEvent,
} from "../../../../types/chat-streaming";
import { chatSessionService } from "../../../../services/chat-session.service";
import { getCheckpointer } from "./checkpointer";
import { truncateToTokenLimit, MAX_CONTEXT_TOKENS } from "./token-utils";

/**
 * Factory class to build and compile the Chat Graph.
 * 
 * The Chat Graph serves as the primary orchestration layer for user conversations.
 * It coordinates subgraphs for Intent, Profile, and Opportunity processing.
 * 
 * Flow:
 * 1. loadContext - Fetch user profile and active intents
 * 2. router - Analyze message and determine routing
 * 3. [subgraph] - Process based on routing decision
 * 4. generateResponse - Synthesize final response
 */
export class ChatGraphFactory {
  constructor(
    private database: ChatGraphCompositeDatabase,
    private embedder: Embedder,
    private scraper: Scraper
  ) {}

  /**
   * Creates and compiles the Chat Graph without persistence.
   * @returns Compiled StateGraph ready for invocation
   */
  public createGraph() {
    return this.buildGraph().compile();
  }

  /**
   * Creates a streaming-enabled graph with optional checkpointer for persistence.
   * @param checkpointer - Optional checkpointer (e.g., MemorySaver or PostgresSaver)
   * @returns Compiled StateGraph ready for streaming
   */
  public createStreamingGraph(checkpointer?: MemorySaver | PostgresSaver) {
    const graph = this.buildGraph();
    if (checkpointer) {
      return graph.compile({ checkpointer });
    }
    return graph.compile();
  }

  /**
   * Load previous messages from a session and convert to LangChain messages.
   * Handles token truncation to fit within context window limits.
   *
   * @param sessionId - The session ID to load context from
   * @param maxMessages - Maximum number of messages to load (default: 20)
   * @returns Array of LangChain BaseMessage objects
   */
  public async loadSessionContext(
    sessionId: string,
    maxMessages: number = 20
  ): Promise<BaseMessage[]> {
    log.info("[ChatGraphFactory.loadSessionContext] Loading session context", {
      sessionId,
      maxMessages,
    });

    try {
      const messages = await chatSessionService.getSessionMessages(sessionId, maxMessages);

      if (messages.length === 0) {
        log.info("[ChatGraphFactory.loadSessionContext] No previous messages found", {
          sessionId,
        });
        return [];
      }

      // Convert database messages to LangChain format
      const langchainMessages = messages.map((msg) => {
        if (msg.role === "user") {
          return new HumanMessage(msg.content);
        } else if (msg.role === "assistant") {
          return new AIMessage(msg.content);
        } else {
          return new SystemMessage(msg.content);
        }
      });

      // Truncate to fit within token limits
      const truncatedMessages = truncateToTokenLimit(langchainMessages, MAX_CONTEXT_TOKENS);

      log.info("[ChatGraphFactory.loadSessionContext] Context loaded", {
        sessionId,
        originalCount: messages.length,
        truncatedCount: truncatedMessages.length,
      });

      return truncatedMessages;
    } catch (error) {
      log.error("[ChatGraphFactory.loadSessionContext] Failed to load context", {
        sessionId,
        error: error instanceof Error ? error.message : String(error),
      });
      // Return empty array on error - don't fail the entire request
      return [];
    }
  }

  /**
   * Streams chat events with full session context.
   * Loads previous conversation history and optionally uses a checkpointer for state persistence.
   *
   * This method:
   * 1. Loads previous messages from the session
   * 2. Prepends them to the current message
   * 3. Optionally uses provided checkpointer with sessionId as thread_id
   * 4. Streams all graph events
   *
   * @param input - Configuration for context-aware streaming
   * @param input.userId - The user's ID
   * @param input.message - The current user message text
   * @param input.sessionId - The session ID for context and persistence
   * @param input.maxContextMessages - Maximum history messages to load (default: 20)
   * @param checkpointer - Optional checkpointer for state persistence (PostgresSaver or MemorySaver)
   * @yields ChatStreamEvent objects
   */
  public async *streamChatEventsWithContext(
    input: {
      userId: string;
      message: string;
      sessionId: string;
      maxContextMessages?: number;
    },
    checkpointer?: MemorySaver | PostgresSaver
  ): AsyncGenerator<ChatStreamEvent> {
    const { userId, message, sessionId, maxContextMessages = 20 } = input;

    log.info("[ChatGraphFactory.streamChatEventsWithContext] Starting context-aware streaming", {
      userId,
      sessionId,
      maxContextMessages,
      hasCheckpointer: !!checkpointer,
    });

    try {
      // Load previous conversation context
      const previousMessages = await this.loadSessionContext(sessionId, maxContextMessages);

      // Add current message
      const allMessages = [...previousMessages, new HumanMessage(message)];

      log.info("[ChatGraphFactory.streamChatEventsWithContext] Context prepared", {
        previousCount: previousMessages.length,
        totalCount: allMessages.length,
      });

      // Stream with context using the optional checkpointer
      yield* this.streamChatEvents(
        {
          userId,
          messages: allMessages,
        },
        sessionId,
        checkpointer
      );
    } catch (error) {
      log.error("[ChatGraphFactory.streamChatEventsWithContext] Stream error", {
        error: error instanceof Error ? error.message : String(error),
      });
      yield createErrorEvent(
        sessionId,
        error instanceof Error ? error.message : "Unknown error during context-aware streaming",
        "CONTEXT_STREAM_ERROR"
      );
    }
  }

  /**
   * Streams chat events from the graph execution.
   * Yields SSE-formatted events for status, routing, subgraph processing, and token streaming.
   *
   * @param input - The input state for the graph (userId and messages)
   * @param sessionId - The session ID for event attribution and thread persistence
   * @param checkpointer - Optional checkpointer for persistence
   * @yields ChatStreamEvent objects
   */
  public async *streamChatEvents(
    input: { userId: string; messages: BaseMessage[] },
    sessionId: string,
    checkpointer?: MemorySaver | PostgresSaver
  ): AsyncGenerator<ChatStreamEvent> {
    const graph = this.createStreamingGraph(checkpointer);
    
    try {
      // Stream events from the graph
      const eventStream = graph.streamEvents(
        {
          userId: input.userId,
          messages: input.messages
        },
        {
          version: "v2",
          configurable: { thread_id: sessionId }
        }
      );

      // Track current node for status events
      let currentNode: string | null = null;
      let tokenIndex = 0;

      for await (const event of eventStream) {
        // Handle chain start events (node transitions)
        if (event.event === 'on_chain_start') {
          const nodeName = event.name || 'unknown';
          
          // Skip internal graph wrapper events
          if (nodeName === 'LangGraph' || nodeName === '__start__') {
            continue;
          }
          
          currentNode = nodeName;
          yield createStatusEvent(sessionId, `Processing: ${nodeName}`);
          
          // Emit routing event when router completes
          // This is handled in on_chain_end below
          
          // Emit subgraph start events
          if (nodeName.includes('subgraph')) {
            const subgraphName = nodeName.replace('_subgraph', '');
            yield createSubgraphStartEvent(sessionId, subgraphName);
          }
        }

        // Handle chain end events
        if (event.event === 'on_chain_end') {
          const nodeName = event.name || 'unknown';
          
          // Skip internal events
          if (nodeName === 'LangGraph' || nodeName === '__start__') {
            continue;
          }

          // Emit routing decision after router completes
          if (nodeName === 'router' && event.data?.output?.routingDecision) {
            const decision = event.data.output.routingDecision as RoutingDecision;
            yield createRoutingEvent(sessionId, decision.target, decision.reasoning);
          }

          // Emit subgraph result events
          if (nodeName.includes('subgraph') && event.data?.output?.subgraphResults) {
            const subgraphName = nodeName.replace('_subgraph', '');
            const results = event.data.output.subgraphResults;
            yield createSubgraphResultEvent(sessionId, subgraphName, results);
          }
        }

        // Handle LLM token streaming from the response generator
        if (event.event === 'on_chat_model_stream') {
          // Check if we're in the response generation phase
          if (currentNode === 'generate_response' && event.data?.chunk) {
            const chunk = event.data.chunk;
            if (isAIMessageChunk(chunk)) {
              const content = chunk.content;
              if (typeof content === 'string' && content) {
                yield createTokenEvent(sessionId, content);
                tokenIndex++;
              }
            }
          }
        }
      }
    } catch (error) {
      log.error('[ChatGraphFactory.streamChatEvents] Stream error', {
        error: error instanceof Error ? error.message : String(error)
      });
      yield createErrorEvent(
        sessionId,
        error instanceof Error ? error.message : 'Unknown error during streaming',
        'STREAM_ERROR'
      );
    }
  }

  /**
   * Internal method to build the graph structure.
   * @returns Uncompiled StateGraph
   */
  private buildGraph() {
    // Initialize Agents
    const routerAgent = new RouterAgent();
    const responseGenerator = new ResponseGeneratorAgent();

    // Initialize Subgraphs
    const intentGraph = new IntentGraphFactory(this.database).createGraph();
    const profileGraph = new ProfileGraphFactory(
      this.database, 
      this.embedder, 
      this.scraper
    ).createGraph();
    const opportunityGraph = new OpportunityGraph(
      this.database, 
      this.embedder
    ).compile();

    // ─────────────────────────────────────────────────────────
    // NODE: Load Context
    // Fetches user profile and active intents from the database
    // ─────────────────────────────────────────────────────────
    const loadContextNode = async (state: typeof ChatGraphState.State) => {
      log.info("[ChatGraph:LoadContext] Loading user context...", { 
        userId: state.userId 
      });

      try {
        const profile = await this.database.getProfile(state.userId);
        
        // TODO: Load active intents from database/intent service
        // This would typically call: await this.database.getActiveIntentsFormatted(state.userId)
        const activeIntents = "No active intents."; 

        log.info("[ChatGraph:LoadContext] Context loaded", { 
          hasProfile: !!profile,
          activeIntents: activeIntents.substring(0, 50)
        });

        return {
          userProfile: profile ?? undefined,
          activeIntents
        };
      } catch (error) {
        log.error("[ChatGraph:LoadContext] Failed to load context", { 
          error: error instanceof Error ? error.message : String(error) 
        });
        return {
          userProfile: undefined,
          activeIntents: "",
          error: "Failed to load user context"
        };
      }
    };

    // ─────────────────────────────────────────────────────────
    // NODE: Router
    // Analyzes message and determines routing target
    // ─────────────────────────────────────────────────────────
    const routerNode = async (state: typeof ChatGraphState.State) => {
      const lastMessage = state.messages[state.messages.length - 1];
      const userMessage = lastMessage?.content?.toString() || "";

      log.info("[ChatGraph:Router] Analyzing message...", { 
        messagePreview: userMessage.substring(0, 50) 
      });

      // Build profile context string for the router
      const profileContext = state.userProfile 
        ? `Name: ${state.userProfile.identity.name}\n` +
          `Bio: ${state.userProfile.identity.bio}\n` +
          `Location: ${state.userProfile.identity.location}\n` +
          `Skills: ${state.userProfile.attributes.skills.join(", ")}\n` +
          `Interests: ${state.userProfile.attributes.interests.join(", ")}`
        : "";

      try {
        const decision = await routerAgent.invoke(
          userMessage,
          profileContext,
          state.activeIntents
        );

        log.info("[ChatGraph:Router] Decision made", { 
          target: decision.target, 
          confidence: decision.confidence 
        });

        return {
          routingDecision: decision as RoutingDecision
        };
      } catch (error) {
        log.error("[ChatGraph:Router] Routing failed", { 
          error: error instanceof Error ? error.message : String(error) 
        });
        return {
          routingDecision: {
            target: "respond" as RouteTarget,
            confidence: 0.5,
            reasoning: "Defaulting to response due to routing error"
          },
          error: "Routing failed"
        };
      }
    };

    // ─────────────────────────────────────────────────────────
    // NODE: Intent Subgraph Wrapper
    // Maps ChatGraphState to IntentGraphState and invokes
    // ─────────────────────────────────────────────────────────
    const intentSubgraphNode = async (state: typeof ChatGraphState.State) => {
      log.info("[ChatGraph:IntentSubgraph] Processing intents...");
      
      const lastMessage = state.messages[state.messages.length - 1];
      const inputContent = lastMessage?.content?.toString() || "";
      
      try {
        // Map ChatGraphState to IntentGraphState input
        const intentInput = {
          userId: state.userId,
          userProfile: state.userProfile
            ? JSON.stringify(state.userProfile)
            : "",
          inputContent,
        };

        const result = await intentGraph.invoke(intentInput);

        log.info("[ChatGraph:IntentSubgraph] Processing complete", {
          actionsCount: result.actions?.length || 0,
          inferredCount: result.inferredIntents?.length || 0
        });

        const subgraphResults: SubgraphResults = {
          intent: {
            actions: result.actions || [],
            inferredIntents: (result.inferredIntents || []).map(
              (i: { description: string }) => i.description
            )
          }
        };

        return { subgraphResults };
      } catch (error) {
        log.error("[ChatGraph:IntentSubgraph] Processing failed", { 
          error: error instanceof Error ? error.message : String(error) 
        });
        return { 
          subgraphResults: { intent: { actions: [], inferredIntents: [] } },
          error: "Intent processing failed"
        };
      }
    };

    // ─────────────────────────────────────────────────────────
    // NODE: Profile Subgraph Wrapper
    // Maps ChatGraphState to ProfileGraphState and invokes
    // ─────────────────────────────────────────────────────────
    const profileSubgraphNode = async (state: typeof ChatGraphState.State) => {
      log.info("[ChatGraph:ProfileSubgraph] Processing profile...");
      
      const hasUpdateContext = !!state.routingDecision?.extractedContext;
      
      try {
        // Map ChatGraphState to ProfileGraphState input
        const profileInput = {
          userId: state.userId,
          input: state.routingDecision?.extractedContext,
          objective: undefined,
          profile: state.userProfile,  // Keep passing existing profile for updates
          hydeDescription: undefined,
          forceUpdate: hasUpdateContext,  // NEW: Set forceUpdate when there's new context
        };

        const result = await profileGraph.invoke(profileInput);

        log.info("[ChatGraph:ProfileSubgraph] Processing complete", {
          hasProfile: !!result.profile
        });

        const subgraphResults: SubgraphResults = {
          profile: {
            updated: !!result.profile,
            profile: result.profile
          }
        };

        return {
          userProfile: result.profile,
          subgraphResults
        };
      } catch (error) {
        log.error("[ChatGraph:ProfileSubgraph] Processing failed", {
          error: error instanceof Error ? error.message : String(error)
        });
        return {
          subgraphResults: { profile: { updated: false } },
          error: "Profile processing failed"
        };
      }
    };

    // ─────────────────────────────────────────────────────────
    // NODE: Opportunity Subgraph Wrapper
    // Maps ChatGraphState to OpportunityGraphState and invokes
    // ─────────────────────────────────────────────────────────
    const opportunitySubgraphNode = async (state: typeof ChatGraphState.State) => {
      log.info("[ChatGraph:OpportunitySubgraph] Finding opportunities...");
      
      // Build HyDE description from user message context
      const lastMessage = state.messages[state.messages.length - 1];
      const hydeDescription = state.routingDecision?.extractedContext || 
        lastMessage?.content?.toString() || "";

      try {
        const opportunityInput = {
          options: {
            hydeDescription,
            limit: 5
          },
          sourceUserId: state.userId,
          sourceProfileContext: state.userProfile 
            ? `${state.userProfile.identity.name}: ${state.userProfile.identity.bio}`
            : "",
          candidates: [],
          opportunities: []
        };

        const result = await opportunityGraph.invoke(opportunityInput);

        // Cast to array since the result might be empty object on error
        const opportunities = Array.isArray(result.opportunities)
          ? result.opportunities
          : [];

        log.info("[ChatGraph:OpportunitySubgraph] Search complete", {
          opportunitiesFound: opportunities.length
        });

        const subgraphResults: SubgraphResults = {
          opportunity: {
            opportunities,
            searchQuery: hydeDescription
          }
        };

        return { subgraphResults };
      } catch (error) {
        log.error("[ChatGraph:OpportunitySubgraph] Processing failed", { 
          error: error instanceof Error ? error.message : String(error) 
        });
        return { 
          subgraphResults: { opportunity: { opportunities: [], searchQuery: "" } },
          error: "Opportunity search failed"
        };
      }
    };

    // ─────────────────────────────────────────────────────────
    // NODE: Direct Response
    // Handles direct responses without subgraph processing
    // ─────────────────────────────────────────────────────────
    const respondDirectNode = async (state: typeof ChatGraphState.State) => {
      log.info("[ChatGraph:RespondDirect] Handling direct response...");
      
      // For simple responses, we proceed directly to response generation
      // The response generator will use the routing decision context
      return {};
    };

    // ─────────────────────────────────────────────────────────
    // NODE: Clarify
    // Handles clarification requests
    // ─────────────────────────────────────────────────────────
    const clarifyNode = async (state: typeof ChatGraphState.State) => {
      log.info("[ChatGraph:Clarify] Requesting clarification...");
      
      // Signal that clarification is needed
      // The response generator will craft an appropriate clarification question
      return {
        subgraphResults: {} as SubgraphResults
      };
    };

    // ─────────────────────────────────────────────────────────
    // NODE: Generate Response
    // Synthesizes final response using streaming LLM
    // ─────────────────────────────────────────────────────────
    const generateResponseNode = async (state: typeof ChatGraphState.State) => {
      const lastMessage = state.messages[state.messages.length - 1];
      const userMessage = lastMessage?.content?.toString() || "";

      log.info("[ChatGraph:GenerateResponse] Generating response with streaming...");

      if (!state.routingDecision) {
        const errorResponse = "I'm sorry, I couldn't process your request. Please try again.";
        return {
          responseText: errorResponse,
          messages: [new AIMessage(errorResponse)]
        };
      }

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

        log.info("[ChatGraph:GenerateResponse] Invoking streaming model", {
          systemPromptLength: systemPrompt.length,
          userPromptLength: userPrompt.length
        });

        // Invoke with streaming enabled
        // LangGraph's streamEvents() will capture `on_chat_model_stream` events from this model
        const response = await streamingModel.invoke([
          new SystemMessage(systemPrompt),
          new HumanMessage(userPrompt)
        ]);

        // Extract the response content
        const responseText = typeof response.content === 'string'
          ? response.content
          : JSON.stringify(response.content);

        log.info("[ChatGraph:GenerateResponse] Streaming response complete", {
          responseLength: responseText.length
        });

        // Get suggested actions separately (non-streaming, happens after main response)
        // This doesn't need to be streamed as it's supplementary data
        let suggestedActions: string[] = [];
        try {
          suggestedActions = await responseGenerator.getSuggestedActions(
            responseText,
            state.routingDecision
          );
        } catch (actionsError) {
          log.warn("[ChatGraph:GenerateResponse] Failed to get suggested actions", {
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
        log.error("[ChatGraph:GenerateResponse] Generation failed", {
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

    // ─────────────────────────────────────────────────────────
    // ROUTING CONDITION
    // Determines which subgraph/node to route to
    // ─────────────────────────────────────────────────────────
    const routeCondition = (state: typeof ChatGraphState.State): RouteTarget => {
      const target = state.routingDecision?.target || "respond";
      
      // Defensive logging: verify target is valid
      const validTargets: RouteTarget[] = [
        "intent_subgraph",
        "profile_subgraph",
        "opportunity_subgraph",
        "respond",
        "clarify"
      ];
      
      if (!validTargets.includes(target)) {
        log.error("[ChatGraph:RouteCondition] Unknown routing target detected!", {
          target,
          routingDecision: state.routingDecision,
          fallbackTo: "respond"
        });
        // Fallback to safe default
        return "respond";
      }
      
      log.info("[ChatGraph:RouteCondition] Routing to target", {
        target,
        confidence: state.routingDecision?.confidence,
        reasoning: state.routingDecision?.reasoning
      });
      
      return target;
    };

    // ─────────────────────────────────────────────────────────
    // GRAPH ASSEMBLY
    // ─────────────────────────────────────────────────────────
    const workflow = new StateGraph(ChatGraphState)
      // Add Nodes
      .addNode("load_context", loadContextNode)
      .addNode("router", routerNode)
      .addNode("intent_subgraph", intentSubgraphNode)
      .addNode("profile_subgraph", profileSubgraphNode)
      .addNode("opportunity_subgraph", opportunitySubgraphNode)
      .addNode("respond_direct", respondDirectNode)
      .addNode("clarify", clarifyNode)
      .addNode("generate_response", generateResponseNode)

      // Define Flow: START -> load_context -> router
      .addEdge(START, "load_context")
      .addEdge("load_context", "router")

      // Conditional Routing from router node
      .addConditionalEdges("router", routeCondition, {
        intent_subgraph: "intent_subgraph",
        profile_subgraph: "profile_subgraph",
        opportunity_subgraph: "opportunity_subgraph",
        respond: "respond_direct",
        clarify: "clarify"
      })

      // All paths lead to response generation
      .addEdge("intent_subgraph", "generate_response")
      .addEdge("profile_subgraph", "generate_response")
      .addEdge("opportunity_subgraph", "generate_response")
      .addEdge("respond_direct", "generate_response")
      .addEdge("clarify", "generate_response")

      // Generate response -> END
      .addEdge("generate_response", END);

    log.info("[ChatGraphFactory] Graph built successfully");
    return workflow;
  }
}
