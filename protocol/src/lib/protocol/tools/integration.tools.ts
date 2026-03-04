import { z } from 'zod';
import type { DefineTool, ToolDeps } from './tool.helpers';
import { success, error } from './tool.helpers';
import { IntegrationAdapter } from '../../../adapters/integration.adapter';

const adapter = new IntegrationAdapter();

/**
 * Creates integration tools for the chat agent.
 * Exposes execute_integration tool for dynamic Composio operations.
 */
export function createIntegrationTools(defineTool: DefineTool, _deps: ToolDeps) {
  const execute_integration = defineTool({
    name: 'execute_integration',
    description: `Execute a dynamic task using the user's connected integrations (Gmail, Calendar, Slack, etc.).
The sub-agent will use available tools based on what's connected.

Examples:
- "Extract all contacts from my email and calendar"
- "Fetch my recent calendar events"
- "Get emails from the last week"

Returns raw output from the integration sub-agent.`,
    querySchema: z.object({
      prompt: z.string().describe('Natural language instruction for the integration task'),
    }),
    handler: async ({ context, query }) => {
      try {
        const result = await adapter.execute(context.userId, query.prompt);
        return success({ result });
      } catch (err) {
        return error(`Integration failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    },
  });

  return [execute_integration];
}
