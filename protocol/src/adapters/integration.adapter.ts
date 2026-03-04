import { ChatOpenAI } from '@langchain/openai';
import { HumanMessage, AIMessage, SystemMessage } from '@langchain/core/messages';
import { ToolNode } from '@langchain/langgraph/prebuilt';
import { StateGraph, MessagesAnnotation } from '@langchain/langgraph';
import { createUserSession } from '../lib/composio/composio';
import { log } from '../lib/log';

const logger = log.lib.from('integration');

const COMPOSIO_SYSTEM_PROMPT = `You are an integration assistant with access to Composio meta-tools.

WORKFLOW:
1. Call COMPOSIO_SEARCH_TOOLS to find relevant tools for the task
2. Check the "connection_status" in the response
3. If NOT connected, call COMPOSIO_MANAGE_CONNECTIONS to get an auth link - return this to the user
4. If connected, call COMPOSIO_MULTI_EXECUTE_TOOL to execute the tools
5. Return the results

IMPORTANT:
- Always search for tools first before executing
- If the user needs to authenticate, return the auth link clearly
- Meta tools share context via session_id, so search results persist to execute calls`;

/**
 * Fully dynamic integration adapter using Composio + LangGraph.
 * Uses Composio's native in-chat authentication via COMPOSIO_MANAGE_CONNECTIONS meta-tool.
 * When a tool requires auth, the meta-tool returns a Connect Link URL for the user.
 */
export class IntegrationAdapter {
  /**
   * Execute a dynamic task using user's connected integrations.
   * If user lacks required connections, returns a connect URL for them to authenticate.
   * @param userId - User ID for Composio session
   * @param prompt - Natural language instruction
   * @returns Raw LLM response string (may include connect URLs if auth needed)
   */
  async execute(userId: string, prompt: string): Promise<string> {
    const session = await createUserSession(userId);
    const tools = await session.tools();

    logger.info('Executing integration task', {
      userId,
      toolCount: tools.length,
      promptPreview: prompt.slice(0, 80),
    });

    if (!tools.length) {
      logger.warn('No tools available (check COMPOSIO_API_KEY)', { userId });
      return JSON.stringify({ 
        error: 'Integration service unavailable', 
        message: 'No integration tools are configured. Please check your Composio setup.',
      });
    }

    const toolNode = new ToolNode(tools);
    const model = new ChatOpenAI({
      model: 'gpt-4o-mini',
      temperature: 0,
      configuration: {
        baseURL: process.env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1',
        apiKey: process.env.OPENROUTER_API_KEY,
      },
    }).bindTools(tools);

    const shouldContinue = (state: typeof MessagesAnnotation.State) => {
      const last = state.messages[state.messages.length - 1] as AIMessage;
      return last.tool_calls?.length ? 'tools' : '__end__';
    };

    const graph = new StateGraph(MessagesAnnotation)
      .addNode('agent', async (state) => {
        logger.info('Agent node invoked', { messageCount: state.messages.length });
        try {
          const response = await model.invoke(state.messages);
          logger.info('Agent response', { 
            hasToolCalls: !!(response as AIMessage).tool_calls?.length,
            toolCalls: (response as AIMessage).tool_calls?.map(tc => tc.name),
          });
          return { messages: [response] };
        } catch (err) {
          logger.error('Agent node error', { error: err instanceof Error ? err.message : String(err) });
          throw err;
        }
      })
      .addNode('tools', async (state) => {
        logger.info('Tools node invoked');
        try {
          const result = await toolNode.invoke(state);
          logger.info('Tools node result', { 
            messageCount: result.messages?.length,
            lastContent: result.messages?.[result.messages.length - 1]?.content?.slice?.(0, 200),
          });
          return result;
        } catch (err) {
          logger.error('Tools node error', { error: err instanceof Error ? err.message : String(err) });
          throw err;
        }
      })
      .addEdge('__start__', 'agent')
      .addConditionalEdges('agent', shouldContinue)
      .addEdge('tools', 'agent')
      .compile();

    try {
      const result = await graph.invoke({
        messages: [new SystemMessage(COMPOSIO_SYSTEM_PROMPT), new HumanMessage(prompt)],
      });

      const lastMessage = result.messages?.[result.messages.length - 1];
      const content =
        typeof lastMessage?.content === 'string'
          ? lastMessage.content
          : JSON.stringify(lastMessage?.content || '');

      logger.info('Integration task completed', { userId, rawResult: content.slice(0, 500) });
      return content;
    } catch (err) {
      logger.error('Graph execution failed', { 
        userId, 
        error: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack : undefined,
      });
      return JSON.stringify({
        error: 'Integration execution failed',
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }
}
