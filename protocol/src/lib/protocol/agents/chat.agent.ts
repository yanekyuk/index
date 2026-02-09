import { ChatOpenAI } from "@langchain/openai";
import { BaseMessage, SystemMessage, ToolMessage } from "@langchain/core/messages";
import { createChatTools, type ToolContext, type ResolvedToolContext } from "../tools";
import { CHAT_AGENT_SYSTEM_PROMPT, ITERATION_NUDGE, buildSystemContent } from "./chat.prompt";
import { protocolLogger } from "../support/protocol.logger";

const logger = protocolLogger("ChatAgent");

// Re-export for external consumers
export { CHAT_AGENT_SYSTEM_PROMPT, ITERATION_NUDGE } from "./chat.prompt";

// ═══════════════════════════════════════════════════════════════════════════════
// CONFIGURATION
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Soft limit: After this many iterations, inject a nudge message.
 */
export const SOFT_ITERATION_LIMIT = 8;

/**
 * Hard limit: Force exit after this many iterations to prevent infinite loops.
 */
export const HARD_ITERATION_LIMIT = 12;

// ═══════════════════════════════════════════════════════════════════════════════
// CHAT AGENT CLASS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Result of a single agent iteration.
 */
export interface AgentIterationResult {
  /** Whether the agent wants to continue (made tool calls) or stop (produced final response) */
  shouldContinue: boolean;
  /** Tool calls made in this iteration (if any) */
  toolCalls?: Array<{
    id: string;
    name: string;
    args: Record<string, unknown>;
  }>;
  /** Tool results from executing the tool calls */
  toolResults?: Array<{
    toolCallId: string;
    name: string;
    result: string;
  }>;
  /** Final response text (if agent is done) */
  responseText?: string;
  /** Updated messages array */
  messages: BaseMessage[];
}

/**
 * ChatAgent: ReAct-style agent that uses tools to help users.
 * 
 * The agent operates in a loop:
 * 1. Receive messages (conversation history + tool results)
 * 2. Decide: call tools OR respond to user
 * 3. If tools called: execute them, add results, loop back
 * 4. If response: return final text
 * 
 * Use `ChatAgent.create(context)` to construct (async factory).
 */
export class ChatAgent {
  private model: ChatOpenAI;
  private tools: Awaited<ReturnType<typeof createChatTools>>;
  private toolsByName: Map<string, any>;

  /**
   * Private constructor — use `ChatAgent.create()` instead.
   */
  private constructor(
    private resolvedContext: ResolvedToolContext,
    tools: Awaited<ReturnType<typeof createChatTools>>,
  ) {
    // Create model with tool calling capability
    this.model = new ChatOpenAI({
      model: 'google/gemini-2.5-flash',
      configuration: {
        baseURL: process.env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1',
        apiKey: process.env.OPENROUTER_API_KEY
      },
      maxTokens: 4096,
    });

    // Store tools and index by name
    this.tools = tools;
    this.toolsByName = new Map();
    for (const tool of this.tools) {
      this.toolsByName.set(tool.name, tool);
    }

    // Bind tools to model
    this.model = this.model.bindTools(this.tools) as ChatOpenAI;
  }

  /**
   * Async factory: creates a ChatAgent with resolved user/index context.
   * Resolves user/index identity from DB during tool initialization.
   */
  static async create(context: ToolContext): Promise<ChatAgent> {
    const tools = await createChatTools(context);
    // Resolve context for system prompt (tools already resolved it internally,
    // but we need it here for the prompt too)
    const db = context.database;
    const user = await db.getUser(context.userId);
    const indexInfo = context.indexId ? await db.getIndex(context.indexId) : null;
    const isOwner = context.indexId ? await db.isIndexOwner(context.indexId, context.userId) : false;
    const resolved: ResolvedToolContext = {
      userId: context.userId,
      userName: user?.name ?? "Unknown",
      userEmail: user?.email ?? "",
      indexId: context.indexId,
      indexName: indexInfo?.title,
      isOwner,
    };
    return new ChatAgent(resolved, tools);
  }

  /**
   * Run a single iteration of the agent loop.
   * 
   * @param messages - Current conversation including any tool results
   * @param iterationCount - Current iteration number (for soft limit)
   * @returns Result indicating whether to continue and any tool calls/response
   */
  async runIteration(
    messages: BaseMessage[],
    iterationCount: number
  ): Promise<AgentIterationResult> {
    const systemContent = buildSystemContent(this.resolvedContext);

    const fullMessages: BaseMessage[] = [
      new SystemMessage(systemContent),
      ...messages
    ];

    // Add nudge if past soft limit
    if (iterationCount >= SOFT_ITERATION_LIMIT) {
      fullMessages.push(new SystemMessage(ITERATION_NUDGE));
    }

    logger.info("Agent iteration", {
      iteration: iterationCount,
      messageCount: messages.length,
      pastSoftLimit: iterationCount >= SOFT_ITERATION_LIMIT
    });

    // Invoke model
    const response = await this.model.invoke(fullMessages);
    logger.debug("Chat model response", {
      content: typeof response.content === "string" ? response.content : JSON.stringify(response.content),
      toolCalls: response.tool_calls?.length ?? 0,
      toolCallNames: response.tool_calls?.map((tc) => tc.name) ?? [],
    });

    // Check if model made tool calls
    const toolCalls = response.tool_calls || [];

    if (toolCalls.length > 0) {
      logger.info("Agent made tool calls", {
        iteration: iterationCount,
        toolCount: toolCalls.length,
        tools: toolCalls.map(tc => tc.name)
      });

      // Execute tools (can be parallelized if independent)
      const toolResults = await this.executeToolCalls(toolCalls);

      // Build updated messages
      const updatedMessages = [
        ...messages,
        response, // AIMessage with tool_calls
        ...toolResults.map(tr => new ToolMessage({
          tool_call_id: tr.toolCallId,
          content: tr.result,
          name: tr.name
        }))
      ];

      return {
        shouldContinue: true,
        toolCalls: toolCalls.map(tc => ({
          id: tc.id!,
          name: tc.name,
          args: tc.args as Record<string, unknown>
        })),
        toolResults,
        messages: updatedMessages
      };
    }

    // No tool calls - agent is responding
    const responseText = typeof response.content === "string"
      ? response.content
      : JSON.stringify(response.content);
    logger.debug("Agent produced response (raw)", { iteration: iterationCount, responseText });
    logger.info("Agent produced response", {
      iteration: iterationCount,
      responseLength: responseText.length,
    });

    return {
      shouldContinue: false,
      responseText,
      messages: [...messages, response]
    };
  }

  /**
   * Execute tool calls, potentially in parallel.
   */
  private async executeToolCalls(
    toolCalls: Array<{ id?: string; name: string; args: Record<string, unknown> }>
  ): Promise<Array<{ toolCallId: string; name: string; result: string }>> {
    // Execute all tool calls in parallel
    const results = await Promise.all(
      toolCalls.map(async (tc) => {
        const tool = this.toolsByName.get(tc.name);
        
        if (!tool) {
          logger.error("Unknown tool", { name: tc.name });
          return {
            toolCallId: tc.id || `unknown-${Date.now()}`,
            name: tc.name,
            result: JSON.stringify({ success: false, error: `Unknown tool: ${tc.name}` })
          };
        }

        try {
          logger.info("Executing tool", { name: tc.name, args: tc.args });
          const result = await tool.invoke(tc.args);
          const resultStr = typeof result === "string" ? result : JSON.stringify(result);
          logger.debug("Tool response", { name: tc.name, result: resultStr });
          logger.info("Tool completed", {
            name: tc.name,
            resultLength: resultStr.length,
          });

          return {
            toolCallId: tc.id || `${tc.name}-${Date.now()}`,
            name: tc.name,
            result: resultStr
          };
        } catch (error) {
          logger.error("Tool execution failed", { 
            name: tc.name, 
            error: error instanceof Error ? error.message : String(error) 
          });
          
          return {
            toolCallId: tc.id || `${tc.name}-${Date.now()}`,
            name: tc.name,
            result: JSON.stringify({ 
              success: false, 
              error: `Tool execution failed: ${error instanceof Error ? error.message : 'Unknown error'}` 
            })
          };
        }
      })
    );

    return results;
  }

  /**
   * Run the full agent loop until completion or hard limit.
   * 
   * @param initialMessages - Starting conversation messages
   * @returns Final response text and full message history
   */
  async run(initialMessages: BaseMessage[]): Promise<{
    responseText: string;
    messages: BaseMessage[];
    iterationCount: number;
  }> {
    let messages = initialMessages;
    let iterationCount = 0;

    while (iterationCount < HARD_ITERATION_LIMIT) {
      const result = await this.runIteration(messages, iterationCount);
      iterationCount++;
      messages = result.messages;

      if (!result.shouldContinue) {
        const responseText = result.responseText || "I apologize, but I couldn't generate a response.";
        logger.debug("Agent final response", { responseText });
        return {
          responseText,
          messages,
          iterationCount
        };
      }
    }

    // Hit hard limit - force a response
    logger.warn("Hit hard iteration limit", { iterationCount });
    
    const forceResponseMessages = [
      new SystemMessage(CHAT_AGENT_SYSTEM_PROMPT),
      ...messages,
      new SystemMessage("You have reached the maximum number of tool calls. You MUST provide a final response now. Summarize what you've accomplished and what might still be needed.")
    ];

    const forcedResponse = await this.model.invoke(forceResponseMessages);
    const responseText = typeof forcedResponse.content === "string"
      ? forcedResponse.content
      : JSON.stringify(forcedResponse.content);
    logger.debug("Agent forced response", { responseText });

    return {
      responseText,
      messages: [...messages, forcedResponse],
      iterationCount
    };
  }
}
