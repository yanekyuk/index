import { StateGraph, START, END, MemorySaver } from "@langchain/langgraph";
import { PostgresSaver } from "@langchain/langgraph-checkpoint-postgres";
import { ChatOpenAI } from "@langchain/openai";
import { AIMessage, BaseMessage, HumanMessage, SystemMessage, isAIMessageChunk } from "@langchain/core/messages";
import { ChatGraphState, RoutingDecision, SubgraphResults } from "./chat.graph.state";
import { RouterAgent, RouteTarget } from "../../agents/chat/router/chat.router";
import { ResponseGeneratorAgent, RESPONSE_GENERATOR_SYSTEM_PROMPT } from "../../agents/chat/generator/chat.generator";
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
  createThinkingEvent,
  createSubgraphStartEvent,
  createSubgraphResultEvent,
  createTokenEvent,
  createErrorEvent,
} from "../../../../types/chat-streaming";
import { chatSessionService } from "../../../../services/chat-session.service";
import { getCheckpointer } from "./chat.checkpointer";
import { truncateToTokenLimit, MAX_CONTEXT_TOKENS } from "./chat.utils";

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
          
          // Emit thinking event for node start
          const nodeDescriptions: Record<string, string> = {
            'load_context': 'Loading user profile and active intents...',
            'router': 'Analyzing your message to determine the best way to help...',
            'intent_query': 'Fetching your active intents...',
            'intent_write': 'Processing intent changes...',
            'profile_query': 'Retrieving your profile...',
            'profile_write': 'Updating your profile...',
            'opportunity_subgraph': 'Searching for relevant opportunities...',
            'respond_direct': 'Preparing response...',
            'clarify': 'Determining what additional information is needed...',
            'generate_response': 'Crafting response...'
          };
          
          const description = nodeDescriptions[nodeName];
          if (description) {
            yield createThinkingEvent(sessionId, description, nodeName);
          }
          
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

          // Emit routing decision after router completes with detailed thinking
          if (nodeName === 'router' && event.data?.output?.routingDecision) {
            const decision = event.data.output.routingDecision as RoutingDecision;
            
            // Emit detailed thinking about routing decision
            const targetDescriptions: Record<string, string> = {
              'intent_query': 'showing your existing intents',
              'intent_write': 'creating or updating intents',
              'profile_query': 'showing your profile',
              'profile_write': 'updating your profile',
              'opportunity_subgraph': 'finding relevant opportunities',
              'respond': 'providing a direct response',
              'clarify': 'asking for clarification'
            };
            
            const targetDesc = targetDescriptions[decision.target] || decision.target;
            const thinkingContent = `Routing decision: ${targetDesc}\n\nReasoning: ${decision.reasoning || 'No specific reasoning provided'}`;
            yield createThinkingEvent(sessionId, thinkingContent, 'router');
            
            yield createRoutingEvent(sessionId, decision.target, decision.reasoning);
          }

          // Emit subgraph result events with thinking
          if (nodeName.includes('subgraph') && event.data?.output?.subgraphResults) {
            const subgraphName = nodeName.replace('_subgraph', '');
            const results = event.data.output.subgraphResults;
            
            // Emit thinking about what the subgraph accomplished
            if (results && typeof results === 'object') {
              let resultSummary = `Completed ${subgraphName} processing`;
              
              // Add specific details based on subgraph type
              if ('intent' in results && results.intent) {
                const intentResult = results.intent as any;
                if (intentResult.actions) {
                  resultSummary += `\n- Actions: ${intentResult.actions.length} intent operations`;
                }
                if (intentResult.intents) {
                  resultSummary += `\n- Found ${intentResult.intents.length} intents`;
                }
              } else if ('profile' in results && results.profile) {
                const profileResult = results.profile as any;
                if (profileResult.updated) {
                  resultSummary += '\n- Profile updated successfully';
                }
              } else if ('opportunity' in results && results.opportunity) {
                const oppResult = results.opportunity as any;
                if (oppResult.opportunities) {
                  resultSummary += `\n- Found ${oppResult.opportunities.length} opportunities`;
                }
              }
              
              yield createThinkingEvent(sessionId, resultSummary, subgraphName);
            }
            
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
        // Pass last 10 messages for context-aware routing (detecting confirmations, etc.)
        const conversationHistory = state.messages.length > 1
          ? state.messages.slice(0, -1).slice(-10)  // Exclude current message, take last 10
          : undefined;
        
        const decision = await routerAgent.invoke(
          userMessage,
          profileContext,
          state.activeIntents,
          conversationHistory
        );

        log.info("[ChatGraph:Router] Decision made", {
          target: decision.target,
          confidence: decision.confidence,
          hadConversationContext: !!conversationHistory
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
    // NODE: Intent Query (Read-Only Fast Path)
    // Directly fetches and formats active intents without graph processing.
    // This is the fast path for "what are my intents?" queries.
    // ─────────────────────────────────────────────────────────
    const intentQueryNode = async (state: typeof ChatGraphState.State) => {
      log.info("[ChatGraph:IntentQuery] 🚀 Fast path: Fetching active intents (read-only)...");
      
      try {
        const activeIntents = await this.database.getActiveIntents(state.userId);
        
        log.info("[ChatGraph:IntentQuery] ✅ Retrieved intents via fast path", {
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
        log.error("[ChatGraph:IntentQuery] Query failed", {
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

    // ─────────────────────────────────────────────────────────
    // NODE: Profile Query (Read-Only Fast Path)
    // Uses profile graph in query mode to return existing profile without generation.
    // Fast path for "show me my profile" queries.
    // ─────────────────────────────────────────────────────────
    const profileQueryNode = async (state: typeof ChatGraphState.State) => {
      log.info("[ChatGraph:ProfileQuery] 🚀 Fast path: Querying profile (read-only)...");
      
      try {
        // Invoke profile graph in query mode (no generation, just retrieval)
        const profileInput = {
          userId: state.userId,
          operationMode: 'query' as const,  // Fast path - no generation
        };

        const result = await profileGraph.invoke(profileInput);

        log.info("[ChatGraph:ProfileQuery] ✅ Profile retrieved via fast path", {
          hasProfile: !!result.profile,
          costSavings: "Profile generation pipeline avoided"
        });

        const subgraphResults: SubgraphResults = {
          profile: {
            mode: 'query',
            profile: result.profile
          }
        };

        return { subgraphResults };
      } catch (error) {
        log.error("[ChatGraph:ProfileQuery] Query failed", {
          error: error instanceof Error ? error.message : String(error)
        });
        return {
          subgraphResults: {
            profile: {
              mode: 'query',
              profile: undefined
            }
          },
          error: "Profile query failed"
        };
      }
    };

    // ─────────────────────────────────────────────────────────
    // NODE: Intent Subgraph Wrapper (Write Path)
    // Maps ChatGraphState to IntentGraphState and invokes
    // Full pipeline for create/update/delete operations
    // Phase 4: Passes operationMode to enable conditional flow
    // Phase 5: Passes conversation context for anaphoric resolution
    // ─────────────────────────────────────────────────────────
    const intentSubgraphNode = async (state: typeof ChatGraphState.State) => {
      const operationType = state.routingDecision?.operationType;
      
      log.info("[ChatGraph:IntentSubgraph] Processing intents", {
        operationType,
        hasRoutingDecision: !!state.routingDecision
      });
      
      const lastMessage = state.messages[state.messages.length - 1];
      const inputContent = lastMessage?.content?.toString() || "";
      
      // Extract conversation context (last 10 messages max for anaphoric resolution)
      // This enables the intent inferrer to resolve references like "that intent"
      const CONTEXT_MESSAGE_LIMIT = 10;
      const conversationContext = state.messages.length > 1
        ? state.messages.slice(-CONTEXT_MESSAGE_LIMIT)
        : undefined;
      
      log.info("[ChatGraph:IntentSubgraph] Conversation context prepared", {
        contextMessagesCount: conversationContext?.length || 0,
        hasContext: !!conversationContext
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
        
        log.info("[ChatGraph:IntentSubgraph] Mapped operation type", {
          operationType,
          operationMode,
          expectedPath: operationMode === 'delete' ? 'prep → reconciliation → execution' :
                       operationMode === 'update' ? 'prep → inference → reconciliation → execution' :
                       'prep → inference → verification → reconciliation → execution'
        });
        
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
        };

        const result = await intentGraph.invoke(intentInput);

        log.info("[ChatGraph:IntentSubgraph] Processing complete", {
          operationMode,
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
          error: error instanceof Error ? error.message : String(error),
          operationType
        });
        return {
          subgraphResults: { intent: { actions: [], inferredIntents: [] } },
          error: "Intent processing failed"
        };
      }
    };

    // ─────────────────────────────────────────────────────────
    // NODE: Profile Subgraph Wrapper (Write Path)
    // Maps ChatGraphState to ProfileGraphState and invokes full pipeline
    // Automatically detects missing profile, embeddings, and hyde components
    // Also detects insufficient user information and requests it
    // ─────────────────────────────────────────────────────────
    const profileSubgraphNode = async (state: typeof ChatGraphState.State) => {
      const operationType = state.routingDecision?.operationType;
      const hasUpdateContext = !!state.routingDecision?.extractedContext;
      
      log.info("[ChatGraph:ProfileSubgraph] Processing profile...", {
        operationType,
        hasUpdateContext
      });
      
      try {
        // Extract and convert null to undefined for the input property
        const extractedContext = state.routingDecision?.extractedContext;
        const inputValue = extractedContext === null ? undefined : extractedContext;
        
        // Map ChatGraphState to ProfileGraphState input
        // NEW: Pass operationMode='write' to enable full conditional pipeline
        const profileInput = {
          userId: state.userId,
          operationMode: 'write' as const,  // Full pipeline with conditional generation
          input: inputValue,
          objective: undefined,
          profile: state.userProfile,  // Keep passing existing profile for updates
          hydeDescription: undefined,
          forceUpdate: hasUpdateContext,  // Set forceUpdate when there's new context
        };

        log.info("[ChatGraph:ProfileSubgraph] Invoking profile graph", {
          operationMode: profileInput.operationMode,
          forceUpdate: profileInput.forceUpdate,
          hasInput: !!profileInput.input,
          hasExistingProfile: !!profileInput.profile
        });

        const result = await profileGraph.invoke(profileInput) as any;

        // Check if profile graph is requesting user information
        if (result.needsUserInfo && result.missingUserInfo?.length > 0) {
          log.info("[ChatGraph:ProfileSubgraph] ⚠️ User information needed", {
            missingInfo: result.missingUserInfo
          });

          // Construct a helpful clarification message
          const missingFields = result.missingUserInfo as string[];
          const fieldDescriptions = {
            social_urls: 'social media profiles (X/Twitter, LinkedIn, GitHub, or personal website)',
            full_name: 'full name (first and last)',
            location: 'location (city and country)'
          };

          const missingDescriptions = missingFields
            .map(field => fieldDescriptions[field as keyof typeof fieldDescriptions])
            .filter(Boolean);

          const clarificationMessage = missingDescriptions.length > 0
            ? `To generate an accurate profile, I need some additional information about you:\n\n` +
              `${missingDescriptions.map((desc, i) => `${i + 1}. Your ${desc}`).join('\n')}\n\n` +
              `This helps me find the right information about you online and create a more accurate profile. Could you please share these details?`
            : `To generate an accurate profile, I need more information about you. Could you share your social media profiles or personal website?`;

          const subgraphResults: SubgraphResults = {
            profile: {
              updated: false,
              needsUserInfo: true,
              missingUserInfo: result.missingUserInfo,
              clarificationMessage
            }
          };

          return {
            subgraphResults
          };
        }

        log.info("[ChatGraph:ProfileSubgraph] ✅ Processing complete", {
          hasProfile: !!result.profile,
          hasError: !!result.error
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
    // Synthesizes final response using streaming LLM with conversation history
    // ─────────────────────────────────────────────────────────
    const generateResponseNode = async (state: typeof ChatGraphState.State) => {
      const lastMessage = state.messages[state.messages.length - 1];
      const userMessage = lastMessage?.content?.toString() || "";

      log.info("[ChatGraph:GenerateResponse] Generating response with streaming and conversation history...", {
        messageCount: state.messages.length
      });

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
          
          log.info("[ChatGraph:GenerateResponse] Including conversation history", {
            historyMessageCount: state.messages.length - 1
          });
        }

        // Add the final user message with structured prompt context
        messages.push(new HumanMessage(userPrompt));

        log.info("[ChatGraph:GenerateResponse] Invoking streaming model", {
          systemPromptLength: systemPrompt.length,
          userPromptLength: userPrompt.length,
          totalMessages: messages.length,
          historyIncluded: state.messages.length > 1
        });

        // Invoke with streaming enabled
        // LangGraph's streamEvents() will capture `on_chat_model_stream` events from this model
        const response = await streamingModel.invoke(messages);

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
    // Determines which subgraph/node to route to based on router decision
    // Supports both new targets (intent_query, intent_write, etc.) and
    // legacy targets (intent_subgraph, profile_subgraph) for backward compatibility
    // ─────────────────────────────────────────────────────────
    const routeCondition = (state: typeof ChatGraphState.State): string => {
      let target: string = state.routingDecision?.target || "respond";
      const operationType = state.routingDecision?.operationType;
      
      // Map legacy targets to new targets for backward compatibility
      const legacyMapping: Record<string, string> = {
        'intent_subgraph': 'intent_write',
        'profile_subgraph': 'profile_write'
      };
      
      if (target in legacyMapping) {
        log.warn('[ChatGraph:RouteCondition] Legacy target detected, mapping to new target', {
          legacyTarget: target,
          newTarget: legacyMapping[target]
        });
        target = legacyMapping[target];
      }
      
      // Defensive validation: verify target is valid
      const validTargets = [
        "intent_query",
        "intent_write",
        "profile_query",
        "profile_write",
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
      
      // Log routing decision with operation type for debugging
      log.info("[ChatGraph:RouteCondition] 🔀 Routing decision", {
        target,
        operationType,
        confidence: state.routingDecision?.confidence,
        reasoning: state.routingDecision?.reasoning?.substring(0, 100),
        fastPath: target.includes('_query')
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
      .addNode("intent_query", intentQueryNode)           // NEW: Fast path for intent queries
      .addNode("intent_write", intentSubgraphNode)        // RENAMED: Was intent_subgraph
      .addNode("profile_query", profileQueryNode)         // NEW: Fast path for profile queries
      .addNode("profile_write", profileSubgraphNode)      // RENAMED: Was profile_subgraph
      .addNode("opportunity_subgraph", opportunitySubgraphNode)
      .addNode("respond_direct", respondDirectNode)
      .addNode("clarify", clarifyNode)
      .addNode("generate_response", generateResponseNode)

      // Define Flow: START -> load_context -> router
      .addEdge(START, "load_context")
      .addEdge("load_context", "router")

      // Conditional Routing from router node
      .addConditionalEdges("router", routeCondition, {
        intent_query: "intent_query",                 // NEW: Route queries to fast path
        intent_write: "intent_write",                 // NEW: Route writes to full pipeline
        profile_query: "profile_query",               // NEW: Route profile queries to fast path
        profile_write: "profile_write",               // NEW: Route profile writes to full pipeline
        opportunity_subgraph: "opportunity_subgraph",
        respond: "respond_direct",
        clarify: "clarify"
      })

      // All paths lead to response generation
      .addEdge("intent_query", "generate_response")       // NEW: Fast path to response
      .addEdge("intent_write", "generate_response")       // RENAMED: From intent_subgraph
      .addEdge("profile_query", "generate_response")      // NEW: Fast path to response
      .addEdge("profile_write", "generate_response")      // RENAMED: From profile_subgraph
      .addEdge("opportunity_subgraph", "generate_response")
      .addEdge("respond_direct", "generate_response")
      .addEdge("clarify", "generate_response")

      // Generate response -> END
      .addEdge("generate_response", END);

    log.info("[ChatGraphFactory] Graph built successfully");
    return workflow;
  }
}
