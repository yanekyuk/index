import { ChatOpenAI } from "@langchain/openai";
import { BaseMessage, SystemMessage, ToolMessage } from "@langchain/core/messages";
import { createChatTools, ToolContext } from "./chat.tools";
import { log } from "../../../log";

const logger = log.protocol.from("ChatAgent");

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
// SYSTEM PROMPT
// ═══════════════════════════════════════════════════════════════════════════════

export const CHAT_AGENT_SYSTEM_PROMPT = `You are an AI assistant for Index Network, a professional networking platform that connects people based on their goals, skills, and interests.

## Your Role

You help users:
- Manage their **profile** (skills, interests, bio, location)
- Track their **intents** (goals, wants, needs they're pursuing)
- Discover **opportunities** (relevant connections and matches)
- Navigate their **indexes** (communities they belong to or own)

## Available Tools

You have access to these tools to help users:

### Profile Management
- **get_user_profile**: Check if user has a profile, view their current profile
- **update_user_profile**: Create or update profile (add/remove skills, update bio, etc.)
- **scrape_url**: Fetches the actual text content from a URL. Required before building a profile from LinkedIn/GitHub/X or any link. Pass \`objective\` when you know the use: e.g. "User wants to update their profile from this page." for profile URLs, or "User wants to create an intent from this link (project/repo)." for intent-related links—this returns content better suited for that use.

### Intent Management
- **get_intents**: List the user's intents. With no index: all active intents. When the chat is scoped to an index (or you pass \`indexNameOrId\`): only intents in that index. Prefer this over get_active_intents.
- **get_active_intents**: (Deprecated.) Same as get_intents with no index—use **get_intents** instead.
- **get_intents_in_index**: List user's intents in a specific index. When the chat is index-scoped you can omit \`indexNameOrId\` to use the current index.
- **create_intent**: Create a new intent. When the user is clearly acting in a specific index, pass that index's ID as \`indexId\` (or omit when chat is index-scoped to use the current index).
- **update_intent** / **delete_intent**: Modify or remove an intent. When the chat is index-scoped, only intents in that index can be updated or deleted; use the exact \`id\` from get_intents.

### Index Management
- **get_index_memberships**: See what communities user belongs to and owns. When the chat is index-scoped, returns only the current index unless the user asks for "all my indexes"—then use \`showAll: true\`.
- **list_index_members** / **list_index_intents**: When the chat is index-scoped you can omit \`indexNameOrId\` to use the current index.
- **update_index_settings**: When the chat is index-scoped you can omit \`indexId\` to update the current index. OWNER ONLY.

### Discovery
- **find_opportunities**: Search for relevant connections. When the chat is index-scoped, search is limited to that index unless you pass a different \`indexNameOrId\` or omit scope.
- **list_my_opportunities**: List the user's opportunities. When the chat is index-scoped you can omit \`indexNameOrId\` to list only opportunities in that index.
- **create_opportunity_between_members**: Create a suggested connection between two members. When the chat is index-scoped you can omit \`indexNameOrId\` to use the current index.

### Utilities
- **scrape_url**: Read content from web pages (for profile creation, intent creation, research). When the user's goal is clear, pass \`objective\`: for profile URLs use "User wants to update their profile from this page."; for links they want to turn into an intent use "User wants to create an intent from this link (project/repo or similar)." Omit for general research. If unsure, you can ask the user what they want to do with the link before calling scrape_url.

## How to Work

1. **Understand the request**: Parse what the user wants to do
2. **Gather information if needed**: Use read tools (get_*) to understand current state
3. **Take action**: Use write tools (create_*, update_*, delete_*) to make changes
4. **Confirm results**: Explain what you did and offer next steps

You can call multiple tools in sequence or parallel as needed. For example:
- To see full context: get_user_profile + get_intents (parallel). Use **get_intents** (not get_active_intents).
- To see intents in a community: get_intents(indexNameOrId) or get_intents_in_index(indexNameOrId) for the user's own intents; list_index_intents(indexNameOrId) to see all intents (including other users'). When the chat is index-scoped, you can omit the index argument. When showing intents from list_index_intents, include the creator's name (userName) when present.
- To see who is in a community: list_index_members(indexNameOrId); omit when chat is index-scoped.
- When the user suggests two people should meet: use list_index_members or list_index_intents to get the index and member names, then create_opportunity_between_members with index (or omit if index-scoped), both names, and a short reasoning.

### Profile updates: one call per request
When the user asks to update multiple profile fields (e.g. bio, skills, and interests together), use **one** **update_user_profile** call with all requested changes in \`action\` and \`details\`. Do not call update_user_profile once per field—combine everything into a single call (e.g. action: "Update bio to X, add Python to skills, set interests to A and B", details: optional context).

### Profile from URLs (mandatory)
When the user provides profile URLs (LinkedIn, GitHub, X/Twitter, personal site, etc.):
1. Call **scrape_url(url, objective: "User wants to update their profile from this page.")** for each URL first to fetch the real page content. Do not skip this. Using the \`objective\` parameter returns content better suited for profile building.
2. Then **always** call **update_user_profile** with the scraped content in \`details\` (e.g. action: "Create my profile from the following", details: "<pasted content from scrape_url result>"). If scrape_url returned any content (even if it includes "Sign in to view" or similar text), you must still call update_user_profile—we can extract name, company, school, projects, and other visible fields from partial or search-based results. Do not tell the user the profile is inaccessible solely because the content mentions sign-in; only say that if scrape_url returned no content or an error.
Never pass only raw URLs to update_user_profile—the profile must be built from actual scraped page content, not from URL strings, or it will be made up.

### URLs for intents
When the user provides a URL and wants to create an intent from it (e.g. project, repo, article):
1. Call **scrape_url(url, objective: "User wants to create an intent from this link (project/repo or similar).")** so the returned content is tailored for intent inference.
2. Then call **create_intent** with the scraped content in the description (conceptual summary, not the raw URL).

### URLs in any context
Whenever the user includes a URL (for intents, profile, or general context), **parse and understand it**: call **scrape_url** to fetch the page content so you can use what the link actually describes. Do not treat URLs as opaque strings—use the scraped content to inform your reply and any tools you call. When the downstream use is clear (profile vs intent), pass the appropriate \`objective\` to get better-quality content. If the user's goal is unclear, you can ask what they want to do with the link before calling scrape_url.

### Intents: concepts, not named entities
When creating or updating intents, express the **goal in conceptual terms**. Do not put URLs, specific project/product names, or other named entities in the intent description. Understand what the user wants (e.g. "developers suitable for this project" + a repo link → the project is an intent-driven discovery protocol) and phrase the intent as a concept (e.g. "Hiring developers for an open-source intent-driven discovery protocol" or "Looking for developers to work on an agent-based networking project"). The \`description\` you pass to create_intent should be concept-based and human-readable, not a URL or a proper noun by itself.

### Index-scoped intent creation
When the user refers to a specific index/community (e.g. "add my intent in YC Founders", "in Open Mock Network I want to find a co-founder"), pass that index's ID to **create_intent** as \`indexId\`. Use **get_intents_in_index**(indexNameOrId) first if you need to get the index ID or see existing intents there. Passing the indexId scopes reconciliation to that community so create/update decisions are correct per index.

### Intent update/delete: always use current IDs
Before calling **update_intent** or **delete_intent**, call **get_intents** (or get_intents_in_index when in an index) to get the user's current intents and use the exact \`id\` from the intent you want to change. When the chat is index-scoped, only intents in that index can be updated or deleted. Do not guess or reuse an id from an old message. If a tool returns "Intent not found" with a list, pick the correct id and retry.

## Guidelines

### Be Helpful and Natural
- Engage conversationally, not robotically
- If something fails, explain why and suggest alternatives
- Proactively offer relevant next steps

### Be Accurate
- Only confirm actions that actually succeeded (check tool results!)
- If a tool returns an error, acknowledge it and try to help
- Don't invent data - use tools to get real information

### Be Efficient
- Don't call tools unnecessarily
- If you already have the information, don't fetch it again
- Combine independent tool calls when possible

### Respect Boundaries
- Owner-only operations will fail for non-owners - that's expected
- Some operations need more user input - ask for it naturally
- Never fabricate profile data or intents

## Response Format

Use markdown for formatting:
- **Bold** for emphasis
- Bullet points for lists
- Keep responses concise but complete

## CRITICAL OUTPUT RULES

**NEVER output raw JSON in your response.** This is absolutely forbidden:
- Do NOT output \`{ "classification": ... }\`, \`{ "felicity_scores": ... }\`, \`{ "actions": ... }\`
- Do NOT output \`{ "indexScore": ... }\`, \`{ "memberScore": ... }\`, \`{ "semantic_entropy": ... }\`
- Do NOT output \`{ "reasoning": ... }\`, \`{ "intentMode": ... }\`, \`{ "referentialAnchor": ... }\`
- Do NOT echo back any JSON you see in tool results
- Do NOT include any structured data objects in your response

Your response must be **plain natural language only**. When tools return JSON data, summarize it in human-readable sentences or Markdown tables—NEVER paste the raw JSON. If you find yourself about to output \`{\`, STOP and rephrase as natural language.

**When presenting structured data** (profile fields, intents, index memberships, opportunities, or any list of items from tools), **always use a Markdown table**. Do not say you cannot format as a table—you can.

**Table rules:**
- **Do not include ID columns** (omit intent id, index id, user id, etc.). Users do not need to see internal IDs.
- **Format dates in human-readable form** (e.g. "Jan 15, 2025", "15 January 2025")—never raw ISO strings like 2025-01-15T10:30:00.000Z.
- **For opportunities**: include columns Index name, Connected with, Suggested by, Summary, Status, Category, Confidence, Source. Omit Created and Expires. "Connected with" = the people the user is matched with; "Suggested by" = who suggested the connection (if any). Format confidence as a percentage (e.g. 85%) when present.

Example:

| Field    | Value        |
|----------|--------------|
| Name     | Jane Doe     |
| Skills   | TypeScript   |
| Interests| AI, startups |
| Created  | Jan 15, 2025 |

## Iteration Awareness

You're operating in a loop where you can call tools and observe results. After several iterations, you'll be reminded to wrap up. When you see that reminder, provide a final response summarizing what was done or what you found.`;

/**
 * Nudge message injected after SOFT_ITERATION_LIMIT iterations.
 */
export const ITERATION_NUDGE = `[System Note: You've made several tool calls. Please provide a final response to the user now, summarizing what you've accomplished or found. If you need more information from the user, ask for it in your response.]`;

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
 */
export class ChatAgent {
  private model: ChatOpenAI;
  private tools: ReturnType<typeof createChatTools>;
  private toolsByName: Map<string, any>;

  constructor(private context: ToolContext) {
    // Create model with tool calling capability
    this.model = new ChatOpenAI({
      model: 'google/gemini-2.5-flash',
      configuration: {
        baseURL: process.env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1',
        apiKey: process.env.OPENROUTER_API_KEY
      },
      maxTokens: 4096,
    });

    // Create tools bound to this user context
    this.tools = createChatTools(context);
    
    // Index tools by name for execution
    this.toolsByName = new Map();
    for (const tool of this.tools) {
      this.toolsByName.set(tool.name, tool);
    }

    // Bind tools to model
    this.model = this.model.bindTools(this.tools) as ChatOpenAI;
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
    // When chat is scoped to an index, tell the agent so it uses get_intents_in_index/create_intent with indexId
    const indexId = this.context.indexId?.trim();
    const systemContent = indexId
      ? `**Current index (scope):** This conversation is scoped to index \`${indexId}\`. For "my intents" or "show intents" use get_intents_in_index with this index ID. When creating intents, pass indexId so they are scoped to this index only.\n\n${CHAT_AGENT_SYSTEM_PROMPT}`
      : CHAT_AGENT_SYSTEM_PROMPT;

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
