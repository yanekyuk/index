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
 * Flow (Reactive with Smart Prerequisites):
 * 1. router - Analyze message first (without full context)
 * 2. check_prerequisites - Smart gate that:
 *    - Respects explicit user requests (profile_query, intent_query)
 *    - Only enforces onboarding when actually needed
 *    - Suggests intents ONLY for general conversation (not explicit requests)
 * 3. Conditional routing based on prerequisites + router decision:
 *    - Missing profile (non-query) → profile_write (onboarding)
 *    - Explicit request → load_context → execute action (honor request)
 *    - Missing intents (no explicit request) → suggest_intents
 *    - Has both → load_context → execute action
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
          
          // Emit thinking event for node start with clear task identification
          const nodeDescriptions: Record<string, { description: string; taskType: string }> = {
            'router': { 
              description: 'Analyzing message to determine the appropriate action...', 
              taskType: 'ROUTING' 
            },
            'check_prerequisites': { 
              description: 'Verifying profile and intent requirements...', 
              taskType: 'PREREQUISITE_CHECK' 
            },
            'load_context': { 
              description: 'Loading user profile and active intents from database...', 
              taskType: 'CONTEXT_LOADING' 
            },
            'suggest_intents': { 
              description: 'Preparing response with intent suggestions...', 
              taskType: 'INTENT_SUGGESTION' 
            },
            'orchestrator': { 
              description: 'Evaluating if additional operations are required...', 
              taskType: 'ORCHESTRATION' 
            },
            'intent_query': { 
              description: 'Executing READ operation: Fetching active intents from database...', 
              taskType: 'INTENT_QUERY' 
            },
            'intent_write': { 
              description: 'Executing WRITE operation: Processing intent creation/update/deletion...', 
              taskType: 'INTENT_WRITE' 
            },
            'profile_query': { 
              description: 'Executing READ operation: Fetching profile from database...', 
              taskType: 'PROFILE_QUERY' 
            },
            'profile_write': { 
              description: 'Executing WRITE operation: Creating/updating user profile...', 
              taskType: 'PROFILE_WRITE' 
            },
            'opportunity_subgraph': { 
              description: 'Executing DISCOVERY operation: Searching for matching opportunities...', 
              taskType: 'OPPORTUNITY_SEARCH' 
            },
            'scrape_web': { 
              description: 'Executing EXTRACTION operation: Scraping content from URL...', 
              taskType: 'WEB_SCRAPE' 
            },
            'respond_direct': { 
              description: 'Preparing direct conversational response...', 
              taskType: 'DIRECT_RESPONSE' 
            },
            'clarify': { 
              description: 'Preparing clarification request...', 
              taskType: 'CLARIFICATION' 
            },
            'generate_response': { 
              description: 'Generating final response based on results...', 
              taskType: 'RESPONSE_GENERATION' 
            }
          };
          
          const nodeInfo = nodeDescriptions[nodeName];
          if (nodeInfo) {
            const thinkingContent = `**[Task: ${nodeInfo.taskType}]**\n${nodeInfo.description}`;
            yield createThinkingEvent(sessionId, thinkingContent, nodeName);
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
            
            // Build detailed thinking content for debugging
            let thinkingContent = '## Routing Decision Analysis\n\n';
            
            // Add thinking steps if available
            if (decision.thinkingSteps && decision.thinkingSteps.length > 0) {
              thinkingContent += '### Thinking Steps\n';
              decision.thinkingSteps.forEach((step, i) => {
                thinkingContent += `${i + 1}. ${step}\n`;
              });
              thinkingContent += '\n';
            }
            
            // Add considered actions if available
            if (decision.consideredActions && decision.consideredActions.length > 0) {
              thinkingContent += '### Considered Actions\n';
              decision.consideredActions.forEach(action => {
                const scoreBar = '█'.repeat(Math.round(action.score * 10)) + '░'.repeat(10 - Math.round(action.score * 10));
                thinkingContent += `- **${action.action}** [${scoreBar}] ${(action.score * 100).toFixed(0)}%\n`;
                thinkingContent += `  ${action.reason}\n`;
              });
              thinkingContent += '\n';
            }
            
            // Add final decision
            const targetDescriptions: Record<string, string> = {
              'intent_query': 'Fetching and displaying your existing intents',
              'intent_write': 'Processing intent creation/update/deletion',
              'profile_query': 'Retrieving your profile information',
              'profile_write': 'Updating your profile',
              'opportunity_subgraph': 'Searching for relevant connections',
              'scrape_web': 'Extracting content from URL',
              'respond': 'Generating conversational response',
              'clarify': 'Requesting clarification'
            };
            
            const targetDesc = targetDescriptions[decision.target] || decision.target;
            thinkingContent += `### Selected Action\n`;
            thinkingContent += `**Task: ${decision.target}** (${decision.operationType || 'N/A'})\n`;
            thinkingContent += `**Description:** ${targetDesc}\n`;
            thinkingContent += `**Confidence:** ${((decision.confidence || 0) * 100).toFixed(0)}%\n`;
            thinkingContent += `**Reasoning:** ${decision.reasoning || 'No specific reasoning provided'}\n`;
            
            if (decision.extractedContext) {
              thinkingContent += `\n**Extracted Context:** "${decision.extractedContext.substring(0, 200)}${decision.extractedContext.length > 200 ? '...' : ''}"`;
            }
            
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
                const ops = profileResult.operationsPerformed || {};
                
                // Build detailed summary of what operations were performed
                const operations: string[] = [];
                if (ops.scraped) operations.push('Scraped information from the web');
                if (ops.generatedProfile) operations.push('Generated profile using ProfileGenerator agent');
                if (ops.embeddedProfile) operations.push('Created profile vector embedding');
                if (ops.generatedHyde) operations.push('Generated HyDE description for matching');
                if (ops.embeddedHyde) operations.push('Created HyDE vector embedding');
                
                if (operations.length > 0) {
                  resultSummary += '\n\nOperations performed:';
                  operations.forEach(op => {
                    resultSummary += `\n✓ ${op}`;
                  });
                } else if (profileResult.updated) {
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
    // NODE: Check Prerequisites
    // Checks if user has a complete profile and active intents.
    // This is the reactive gate that determines if we need onboarding.
    // ─────────────────────────────────────────────────────────
    const checkPrerequisitesNode = async (state: typeof ChatGraphState.State) => {
      log.info("[ChatGraph:CheckPrerequisites] Checking user prerequisites...", { 
        userId: state.userId 
      });

      try {
        // Load profile to check completeness
        const profile = await this.database.getProfile(state.userId);
        
        // Check if profile is complete (has name, and ideally location/socials)
        const hasCompleteProfile = !!(
          profile && 
          profile.identity?.name &&
          profile.identity.name.trim() !== ''
        );

        // Load active intents to check if user has any
        const activeIntents = await this.database.getActiveIntents(state.userId);
        const hasActiveIntents = activeIntents.length > 0;

        log.info("[ChatGraph:CheckPrerequisites] Prerequisites checked", { 
          hasCompleteProfile,
          hasActiveIntents,
          profileName: profile?.identity?.name,
          intentCount: activeIntents.length
        });

        return {
          hasCompleteProfile,
          hasActiveIntents,
          prerequisitesChecked: true,
          userProfile: profile ?? undefined
        };
      } catch (error) {
        log.error("[ChatGraph:CheckPrerequisites] Failed to check prerequisites", { 
          error: error instanceof Error ? error.message : String(error) 
        });
        return {
          hasCompleteProfile: false,
          hasActiveIntents: false,
          prerequisitesChecked: true,
          error: "Failed to check prerequisites"
        };
      }
    };

    // ─────────────────────────────────────────────────────────
    // NODE: Load Context
    // Fetches user profile and active intents from the database
    // NOW CALLED AFTER prerequisites check and message analysis
    // ─────────────────────────────────────────────────────────
    const loadContextNode = async (state: typeof ChatGraphState.State) => {
      log.info("[ChatGraph:LoadContext] Loading full user context...", { 
        userId: state.userId 
      });

      try {
        const profile = state.userProfile || await this.database.getProfile(state.userId);
        
        // Load and format active intents
        const activeIntents = await this.database.getActiveIntents(state.userId);
        const formattedIntents = activeIntents.length > 0
          ? activeIntents.map(intent => `- ${intent.payload} (${intent.summary || 'no summary'})`).join('\n')
          : "No active intents.";

        log.info("[ChatGraph:LoadContext] Context loaded", { 
          hasProfile: !!profile,
          intentCount: activeIntents.length
        });

        return {
          userProfile: profile ?? undefined,
          activeIntents: formattedIntents
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
    // NOW CALLED FIRST - works with minimal context
    // ─────────────────────────────────────────────────────────
    const routerNode = async (state: typeof ChatGraphState.State) => {
      const lastMessage = state.messages[state.messages.length - 1];
      const userMessage = lastMessage?.content?.toString() || "";

      log.info("[ChatGraph:Router] 🎯 Analyzing message...", { 
        messagePreview: userMessage.substring(0, 50),
        fullMessage: userMessage,
        hasProfile: !!state.userProfile,
        messageCount: state.messages.length
      });

      // Build profile context string for the router (may be minimal if prerequisites not checked yet)
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
        
        log.info("[ChatGraph:Router] 📜 Conversation context for router", {
          historyLength: conversationHistory?.length || 0,
          recentMessages: conversationHistory?.slice(-3).map(m => ({
            role: m._getType(),
            content: typeof m.content === 'string' ? m.content.substring(0, 100) : '[non-string]'
          }))
        });
        
        const decision = await routerAgent.invoke(
          userMessage,
          profileContext,
          state.activeIntents || "",
          conversationHistory
        );

        log.info("[ChatGraph:Router] ✅ Decision made", {
          target: decision.target,
          operationType: decision.operationType,
          confidence: decision.confidence,
          reasoning: decision.reasoning,
          extractedContext: decision.extractedContext 
            ? `"${decision.extractedContext.substring(0, 100)}..."` 
            : null,
          hadConversationContext: !!conversationHistory
        });

        return {
          routingDecision: decision as RoutingDecision
        };
      } catch (error) {
        log.error("[ChatGraph:Router] ❌ Routing failed", { 
          error: error instanceof Error ? error.message : String(error) 
        });
        return {
          routingDecision: {
            target: "respond" as RouteTarget,
            confidence: 0.5,
            reasoning: "Defaulting to response due to routing error",
            extractedContext: null,
            operationType: null
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
      const extractedContext = state.routingDecision?.extractedContext;
      
      log.info("[ChatGraph:IntentSubgraph] 🎯 Starting intent processing", {
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
      
      log.info("[ChatGraph:IntentSubgraph] 📝 Input content decision", {
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
      
      log.info("[ChatGraph:IntentSubgraph] 📜 Conversation context for intent graph", {
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
        
        log.info("[ChatGraph:IntentSubgraph] 🔀 Mapped operation type", {
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

        log.info("[ChatGraph:IntentSubgraph] 🚀 Invoking intent graph with input", {
          userId: intentInput.userId,
          hasUserProfile: !!intentInput.userProfile,
          inputContentLength: inputContent.length,
          inputContentPreview: `"${inputContent.substring(0, 150)}..."`,
          operationMode,
          hasConversationContext: !!conversationContext
        });

        const result = await intentGraph.invoke(intentInput);

        log.info("[ChatGraph:IntentSubgraph] ✅ Intent graph complete", {
          operationMode,
          actionsCount: result.actions?.length || 0,
          inferredCount: result.inferredIntents?.length || 0,
          actions: result.actions?.map(a => ({
            type: a.type,
            payload: 'payload' in a ? a.payload?.substring(0, 50) : undefined,
            id: 'id' in a ? a.id : undefined
          })),
          inferredIntents: result.inferredIntents?.map((i: any) => 
            typeof i === 'string' ? i.substring(0, 50) : i.description?.substring(0, 50)
          )
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
        log.error("[ChatGraph:IntentSubgraph] ❌ Processing failed", {
          error: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? error.stack : undefined,
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
        // Extract and convert null to undefined for the input property.
        // Do not pass confirmation-only text (e.g. "Yes") as profile input — profile graph
        // should ask for user info / use scraper instead of inventing a profile.
        const extractedContext = state.routingDecision?.extractedContext;
        const rawInput = extractedContext === null ? undefined : extractedContext;
        
        // Check if this is a confirmation-only message for CREATE operations
        const isCreateWithConfirmationOnly =
          operationType === 'create' &&
          rawInput &&
          rawInput.trim().length < 50 &&
          /^(yes|yeah|yep|sure|ok(ay)?|go ahead|do it|please|correct|right|exactly|create one|create it|set one up|set it up|create my profile|create profile|set up profile|create a profile)$/i.test(rawInput.trim().replace(/[.!?]+$/, ""));
        
        // Check if extractedContext contains a skill addition command
        // Format: "Add skills: JavaScript, PostgreSQL, Node.js"
        const skillAdditionPattern = /^add skills?:\s*(.+)$/i;
        const skillMatch = rawInput?.match(skillAdditionPattern);
        
        // HANDLE DIRECT SKILL ADDITION
        // If this is a skill addition request and we have an existing profile,
        // directly add the skills without regenerating the entire profile
        if (skillMatch && operationType === 'update' && state.userProfile) {
          const skillsToAdd = skillMatch[1].split(',').map(s => s.trim()).filter(Boolean);
          
          log.info("[ChatGraph:ProfileSubgraph] Direct skill addition detected", {
            skillsToAdd,
            currentSkills: state.userProfile.attributes.skills
          });
          
          // Merge new skills with existing skills (avoid duplicates)
          const existingSkills = state.userProfile.attributes.skills || [];
          const updatedSkills = [...new Set([...existingSkills, ...skillsToAdd])];
          
          // Create updated profile
          const updatedProfile = {
            ...state.userProfile,
            attributes: {
              ...state.userProfile.attributes,
              skills: updatedSkills
            }
          };
          
          // Save updated profile directly
          try {
            await this.database.saveProfile(state.userId, updatedProfile);
            
            log.info("[ChatGraph:ProfileSubgraph] ✅ Skills added successfully", {
              addedSkills: skillsToAdd,
              totalSkills: updatedSkills.length
            });
            
            const subgraphResults: SubgraphResults = {
              profile: {
                mode: 'write',
                updated: true,
                profile: updatedProfile,
                operationsPerformed: {
                  addedSkills: skillsToAdd,
                  directUpdate: true
                }
              } as any
            };
            
            return {
              userProfile: updatedProfile,
              subgraphResults,
              completedOperations: ['profile_write']
            };
          } catch (error) {
            log.error("[ChatGraph:ProfileSubgraph] Failed to add skills", {
              error: error instanceof Error ? error.message : String(error)
            });
            return {
              subgraphResults: {
                profile: {
                  mode: 'write',
                  updated: false,
                  error: "Failed to add skills"
                }
              },
              error: "Skill addition failed"
            };
          }
        }
        
        // Otherwise, proceed with normal profile generation flow
        let inputValue = rawInput;
        
        if (isCreateWithConfirmationOnly) {
          inputValue = undefined;
        }

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

          // Construct a helpful, precise clarification message
          const missingFields = result.missingUserInfo as string[];
          
          // Categorize what's missing
          const missingSocials = missingFields.includes('social_urls');
          const missingFullName = missingFields.includes('full_name');
          const missingLocation = missingFields.includes('location');

          let clarificationMessage = "To create your profile, I need to gather accurate information about you from the web.\n\n";

          // Explain minimum requirement
          if (missingSocials && missingFullName) {
            clarificationMessage += "I need at least one of the following:\n\n";
            clarificationMessage += "• **Social media profile** (X/Twitter, LinkedIn, GitHub, or personal website) - this helps me find the right person\n";
            clarificationMessage += "• **Your full name** (first and last name)\n\n";
            
            if (missingLocation) {
              clarificationMessage += "Optionally, your **location** (city and country) would help ensure I find the correct information.\n\n";
            }
            
            clarificationMessage += "Could you please share at least one social profile link or your full name?";
          } else if (missingSocials) {
            clarificationMessage += "I have your name, but a social media profile link would help me find more accurate information about you.\n\n";
            clarificationMessage += "Could you share a link to your X/Twitter, LinkedIn, GitHub, or personal website?";
          } else if (missingFullName) {
            clarificationMessage += "I need your full name (first and last) to search for information about you.\n\n";
            clarificationMessage += "What's your full name?";
          } else {
            // Just location missing (shouldn't happen since location is optional)
            clarificationMessage = "To create an accurate profile, could you share your location (city and country)?";
          }

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
          hasError: !!result.error,
          operationsPerformed: result.operationsPerformed
        });

        const subgraphResults: SubgraphResults = {
          profile: {
            updated: !!result.profile,
            profile: result.profile,
            operationsPerformed: result.operationsPerformed || {}
          } as any
        };

        return {
          userProfile: result.profile,
          subgraphResults,
          completedOperations: ['profile_write']
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
    // NODE: Suggest Intents
    // When user has profile but no intents and sends a general message,
    // respond naturally and mention that intents are available.
    // ─────────────────────────────────────────────────────────
    const suggestIntentsNode = async (state: typeof ChatGraphState.State) => {
      log.info("[ChatGraph:SuggestIntents] User has profile but no intents, preparing natural response with suggestion...");
      
      const profile = state.userProfile;
      const lastMessage = state.messages[state.messages.length - 1];
      const userMessage = lastMessage?.content?.toString() || "";
      
      if (!profile) {
        log.warn("[ChatGraph:SuggestIntents] No profile available for intent suggestions");
        return {};
      }

      // Get profile details for context
      const skills = profile.attributes?.skills || [];
      const interests = profile.attributes?.interests || [];
      const userName = profile.identity?.name?.split(' ')[0] || 'there';
      
      // Create a more natural, conversational suggestion
      // The response generator will use this to craft an appropriate response
      let contextMessage = `User "${userName}" has a profile but no active intents. `;
      contextMessage += `They have skills in: ${skills.slice(0, 3).join(', ') || 'not specified'}. `;
      contextMessage += `Their interests include: ${interests.slice(0, 3).join(', ') || 'not specified'}. `;
      contextMessage += `\n\nThe user said: "${userMessage}"\n\n`;
      contextMessage += `INSTRUCTION: Respond naturally to their message first. `;
      contextMessage += `Then casually mention that they can share their goals or what they're looking for `;
      contextMessage += `to help connect with relevant people. Don't be pushy about creating intents - `;
      contextMessage += `just let them know the option exists. Keep it friendly and brief.`;

      log.info("[ChatGraph:SuggestIntents] Prepared natural response context", {
        userName,
        hasSkills: skills.length > 0,
        hasInterests: interests.length > 0,
        userMessagePreview: userMessage.substring(0, 50)
      });

      return {
        subgraphResults: {
          intentSuggestion: {
            mode: 'natural_suggestion',
            contextMessage,
            userName,
            skills,
            interests,
            userMessage
          }
        } as any
      };
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
    // NODE: Scrape Web
    // Extracts content from a URL using Parallel.ai
    // ─────────────────────────────────────────────────────────
    const scrapeWebNode = async (state: typeof ChatGraphState.State) => {
      log.info("[ChatGraph:ScrapeWeb] Extracting content from URL...");
      
      // Extract URL from routing decision context
      const url = state.routingDecision?.extractedContext;
      
      if (!url) {
        log.error("[ChatGraph:ScrapeWeb] No URL provided in routing context");
        return {
          subgraphResults: {
            scrape: {
              url: null,
              content: null,
              error: "No URL provided"
            }
          },
          error: "No URL to scrape"
        };
      }

      try {
        log.info("[ChatGraph:ScrapeWeb] Scraping URL", { url });
        const content = await this.scraper.extractUrlContent(url);
        
        if (!content) {
          log.warn("[ChatGraph:ScrapeWeb] No content extracted", { url });
          return {
            subgraphResults: {
              scrape: {
                url,
                content: null,
                error: "Failed to extract content from URL"
              }
            }
          };
        }

        log.info("[ChatGraph:ScrapeWeb] Content extracted successfully", {
          url,
          contentLength: content.length
        });

        return {
          subgraphResults: {
            scrape: {
              url,
              content,
              contentLength: content.length
            }
          },
          completedOperations: ['scrape_web']
        };
      } catch (error) {
        log.error("[ChatGraph:ScrapeWeb] Scraping failed", {
          url,
          error: error instanceof Error ? error.message : String(error)
        });
        return {
          subgraphResults: {
            scrape: {
              url,
              content: null,
              error: error instanceof Error ? error.message : "Unknown error"
            }
          },
          error: "Web scraping failed"
        };
      }
    };

    // ─────────────────────────────────────────────────────────
    // NODE: Orchestrator
    // Checks if more operations are needed before responding
    // Enables chaining operations (e.g., scrape → profile_write)
    // ─────────────────────────────────────────────────────────
    const orchestratorNode = async (state: typeof ChatGraphState.State) => {
      const lastMessage = state.messages[state.messages.length - 1];
      const userMessage = lastMessage?.content?.toString() || "";
      const completedOps = state.completedOperations || [];
      
      log.info("[ChatGraph:Orchestrator] Checking if more operations needed", {
        userMessage: userMessage.substring(0, 50),
        completedOps,
        hasScrapedContent: !!state.subgraphResults?.scrape?.content
      });

      // Check if we just scraped content and should now process it
      const justScraped = completedOps.includes('scrape_web');
      const hasScrapedContent = !!state.subgraphResults?.scrape?.content;
      const scrapeFailed = !!state.subgraphResults?.scrape?.error;
      
      // Patterns that indicate user wants to use scraped content
      const wantsProfileUpdate = /update.*(profile|skills|bio)|add.*(to|skills|profile)/i.test(userMessage);
      
      // If we just scraped successfully and user wants profile update, do it
      if (justScraped && hasScrapedContent && wantsProfileUpdate && !completedOps.includes('profile_write')) {
        log.info("[ChatGraph:Orchestrator] Scraped content available and profile update requested, routing to profile_write");
        
        return {
          needsMoreOperations: true,
          routingDecision: {
            target: 'profile_write' as const,
            confidence: 0.9,
            reasoning: '[ORCHESTRATOR] Chaining scrape → profile_write based on user intent',
            extractedContext: state.subgraphResults?.scrape?.content || null,
            operationType: 'update' as const
          }
        };
      }
      
      // No more operations needed, proceed to response
      log.info("[ChatGraph:Orchestrator] No more operations needed, proceeding to response");
      return {
        needsMoreOperations: false
      };
    };

    // ─────────────────────────────────────────────────────────
    // NODE: Generate Response
    // Synthesizes final response using streaming LLM with conversation history
    // ─────────────────────────────────────────────────────────
    const generateResponseNode = async (state: typeof ChatGraphState.State) => {
      const lastMessage = state.messages[state.messages.length - 1];
      const userMessage = lastMessage?.content?.toString() || "";

      log.info("[ChatGraph:GenerateResponse] 💬 Starting response generation", {
        messageCount: state.messages.length,
        userMessage: `"${userMessage}"`,
        hasRoutingDecision: !!state.routingDecision,
        hasSubgraphResults: !!state.subgraphResults
      });

      if (!state.routingDecision) {
        log.error("[ChatGraph:GenerateResponse] ❌ No routing decision available");
        const errorResponse = "I'm sorry, I couldn't process your request. Please try again.";
        return {
          responseText: errorResponse,
          messages: [new AIMessage(errorResponse)]
        };
      }
      
      log.info("[ChatGraph:GenerateResponse] 📊 Subgraph results summary", {
        hasIntentResults: !!state.subgraphResults?.intent,
        intentActionsCount: state.subgraphResults?.intent?.actions?.length || 0,
        intentInferredCount: state.subgraphResults?.intent?.inferredIntents?.length || 0,
        intentActions: state.subgraphResults?.intent?.actions?.map(a => ({
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

        log.info("[ChatGraph:GenerateResponse] 📝 Built prompts for LLM", {
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
          
          log.info("[ChatGraph:GenerateResponse] 📜 Including conversation history", {
            historyMessageCount: state.messages.length - 1,
            recentHistory: state.messages.slice(-3, -1).map(m => ({
              role: m._getType(),
              preview: typeof m.content === 'string' ? m.content.substring(0, 80) : '[non-string]'
            }))
          });
        }

        // Add the final user message with structured prompt context
        messages.push(new HumanMessage(userPrompt));

        log.info("[ChatGraph:GenerateResponse] 🚀 Invoking streaming model", {
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

        log.info("[ChatGraph:GenerateResponse] ✅ Streaming response complete", {
          responseLength: responseText.length,
          responsePreview: responseText.substring(0, 200)
        });

        // Get suggested actions separately (non-streaming, happens after main response)
        // This doesn't need to be streamed as it's supplementary data
        let suggestedActions: string[] = [];
        try {
          suggestedActions = await responseGenerator.getSuggestedActions(
            responseText,
            state.routingDecision
          );
          
          log.info("[ChatGraph:GenerateResponse] 💡 Suggested actions generated", {
            actionsCount: suggestedActions.length,
            actions: suggestedActions
          });
        } catch (actionsError) {
          log.warn("[ChatGraph:GenerateResponse] ⚠️ Failed to get suggested actions", {
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
        log.error("[ChatGraph:GenerateResponse] ❌ Generation failed", {
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
    // GRAPH ASSEMBLY
    // ─────────────────────────────────────────────────────────
    
    // ─────────────────────────────────────────────────────────
    // ROUTING CONDITION: Prerequisites Check
    // Determines if we need profile/intent onboarding before proceeding.
    // 
    // BUSINESS LOGIC (per user requirements):
    // 1. ALWAYS force profile creation first (except profile_query which shows current state)
    // 2. When user has profile but no intents and sends general message:
    //    respond normally, then mention intents are available
    // ─────────────────────────────────────────────────────────
    const prerequisitesCondition = (state: typeof ChatGraphState.State): string => {
      const routingTarget = state.routingDecision?.target;
      const operationType = state.routingDecision?.operationType;
      
      log.info("[ChatGraph:PrerequisitesCondition] 🔍 Evaluating prerequisites", {
        routingTarget,
        operationType,
        hasCompleteProfile: state.hasCompleteProfile,
        hasActiveIntents: state.hasActiveIntents,
        thinkingSteps: (state.routingDecision as any)?.thinkingSteps?.slice(0, 2)
      });
      
      // ═══════════════════════════════════════════════════════════════
      // RULE 1: Profile Completion Check (ENFORCED)
      // Always require profile UNLESS user is asking to see their current profile
      // ═══════════════════════════════════════════════════════════════
      if (!state.hasCompleteProfile && routingTarget !== 'profile_query') {
        log.info("[ChatGraph:PrerequisitesCondition] ⚠️ PROFILE REQUIRED - No complete profile found", {
          originalTarget: routingTarget,
          redirectingTo: 'profile_write',
          reason: 'Profile must be created before other operations'
        });
        return "profile_write";
      }
      
      // ═══════════════════════════════════════════════════════════════
      // RULE 2: Explicit Requests - Honor User Intent
      // If user explicitly requests an action, proceed with it
      // ═══════════════════════════════════════════════════════════════
      const isExplicitRequest = routingTarget && [
        'profile_query',
        'profile_write',
        'intent_query',
        'intent_write',
        'opportunity_subgraph',
        'scrape_web'
      ].includes(routingTarget);
      
      if (isExplicitRequest) {
        log.info("[ChatGraph:PrerequisitesCondition] ✅ EXPLICIT REQUEST - Honoring user action", {
          target: routingTarget,
          operationType,
          hasProfile: state.hasCompleteProfile,
          hasIntents: state.hasActiveIntents
        });
        return "load_context";
      }
      
      // ═══════════════════════════════════════════════════════════════
      // RULE 3: No Intents + General Conversation = Natural Suggestion
      // User has profile but no intents and is just chatting
      // Respond naturally, then mention intents are available
      // ═══════════════════════════════════════════════════════════════
      if (!state.hasActiveIntents && (routingTarget === 'respond' || routingTarget === 'clarify')) {
        log.info("[ChatGraph:PrerequisitesCondition] 💬 GENERAL CHAT - Profile exists, no intents", {
          action: 'Will respond naturally and mention intents casually',
          routingTarget
        });
        return "suggest_intents";
      }
      
      // ═══════════════════════════════════════════════════════════════
      // RULE 4: Default - Proceed to load context
      // User has profile (and possibly intents), continue normal flow
      // ═══════════════════════════════════════════════════════════════
      log.info("[ChatGraph:PrerequisitesCondition] ✅ ALL PREREQUISITES MET - Loading context", {
        routingTarget,
        hasProfile: state.hasCompleteProfile,
        hasIntents: state.hasActiveIntents
      });
      return "load_context";
    };

    // ─────────────────────────────────────────────────────────
    // ROUTING CONDITION: Main Router
    // Determines which subgraph/node to route to based on router decision
    // ─────────────────────────────────────────────────────────
    const routeCondition = (state: typeof ChatGraphState.State): string => {
      let target: string = state.routingDecision?.target || "respond";
      const operationType = state.routingDecision?.operationType;
      const extractedContext = state.routingDecision?.extractedContext;
      
      log.info("[ChatGraph:RouteCondition] 🔀 Evaluating routing condition", {
        originalTarget: target,
        operationType,
        confidence: state.routingDecision?.confidence,
        hasExtractedContext: !!extractedContext,
        extractedContextPreview: extractedContext?.substring(0, 100)
      });
      
      // Map legacy targets to new targets for backward compatibility
      const legacyMapping: Record<string, string> = {
        'intent_subgraph': 'intent_write',
        'profile_subgraph': 'profile_write'
      };
      
      if (target in legacyMapping) {
        log.warn('[ChatGraph:RouteCondition] ⚠️ Legacy target detected, mapping to new target', {
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
        "scrape_web",
        "respond",
        "clarify"
      ];
      
      if (!validTargets.includes(target)) {
        log.error("[ChatGraph:RouteCondition] ❌ Unknown routing target detected!", {
          target,
          routingDecision: state.routingDecision,
          fallbackTo: "respond"
        });
        // Fallback to safe default
        return "respond";
      }
      
      // Log routing decision with operation type for debugging
      log.info("[ChatGraph:RouteCondition] ✅ Final routing decision", {
        target,
        operationType,
        confidence: state.routingDecision?.confidence,
        reasoning: state.routingDecision?.reasoning?.substring(0, 100),
        hasExtractedContext: !!extractedContext,
        fastPath: target.includes('_query'),
        willInvokeSubgraph: target.includes('_write') || target.includes('_subgraph')
      });
      
      return target;
    };
    
    // ─────────────────────────────────────────────────────────
    // ROUTING CONDITION: Orchestrator
    // Determines if we should chain another operation or proceed to response
    // ─────────────────────────────────────────────────────────
    const orchestratorCondition = (state: typeof ChatGraphState.State): string => {
      if (state.needsMoreOperations && state.routingDecision?.target) {
        const target = state.routingDecision.target;
        log.info("[ChatGraph:OrchestratorCondition] Chaining to next operation", {
          target
        });
        return target;
      }
      
      log.info("[ChatGraph:OrchestratorCondition] Proceeding to response generation");
      return "generate_response";
    };

    const workflow = new StateGraph(ChatGraphState)
      // Add Nodes
      .addNode("router", routerNode)                      // MOVED: First node now
      .addNode("check_prerequisites", checkPrerequisitesNode)  // NEW: Prerequisites gate
      .addNode("load_context", loadContextNode)           // MOVED: After prerequisites
      .addNode("suggest_intents", suggestIntentsNode)     // NEW: Suggest intents when none exist
      .addNode("orchestrator", orchestratorNode)
      .addNode("intent_query", intentQueryNode)
      .addNode("intent_write", intentSubgraphNode)
      .addNode("profile_query", profileQueryNode)
      .addNode("profile_write", profileSubgraphNode)
      .addNode("opportunity_subgraph", opportunitySubgraphNode)
      .addNode("scrape_web", scrapeWebNode)
      .addNode("respond_direct", respondDirectNode)
      .addNode("clarify", clarifyNode)
      .addNode("generate_response", generateResponseNode)

      // Define Flow: START -> router (analyze message first)
      .addEdge(START, "router")
      .addEdge("router", "check_prerequisites")

      // Conditional routing based on prerequisites
      .addConditionalEdges("check_prerequisites", prerequisitesCondition, {
        profile_write: "profile_write",      // Missing profile → onboarding
        suggest_intents: "suggest_intents",  // Has profile but no intents → suggest
        load_context: "load_context"         // Has both → normal flow
      })

      // After loading context, route to appropriate action
      .addConditionalEdges("load_context", routeCondition, {
        intent_query: "intent_query",
        intent_write: "intent_write",
        profile_query: "profile_query",
        profile_write: "profile_write",
        opportunity_subgraph: "opportunity_subgraph",
        scrape_web: "scrape_web",
        respond: "respond_direct",
        clarify: "clarify"
      })

      // Prerequisite-driven flows go directly to response
      .addEdge("suggest_intents", "generate_response")

      // Operations that can be chained go through orchestrator
      // Operations that are terminal go directly to response
      .addEdge("scrape_web", "orchestrator")              // Can chain to profile_write
      .addEdge("intent_query", "generate_response")       // Terminal: Fast path to response
      .addEdge("intent_write", "generate_response")       // Terminal
      .addEdge("profile_query", "generate_response")      // Terminal: Fast path to response
      .addEdge("profile_write", "generate_response")      // Terminal
      .addEdge("opportunity_subgraph", "generate_response")  // Terminal
      .addEdge("respond_direct", "generate_response")     // Terminal
      .addEdge("clarify", "generate_response")            // Terminal

      // Orchestrator can route to another operation or proceed to response
      .addConditionalEdges("orchestrator", orchestratorCondition, {
        profile_write: "profile_write",
        intent_write: "intent_write",
        generate_response: "generate_response"
      })

      // Generate response -> END
      .addEdge("generate_response", END);

    log.info("[ChatGraphFactory] Graph built successfully (reactive flow)");
    return workflow;
  }
}
