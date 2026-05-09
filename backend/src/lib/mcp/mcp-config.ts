export interface McpServerConfig {
  name: string;
  url: string;
  headers: Record<string, string>;
}

/**
 * Builds the MCP server config snippet returned by the headless signup endpoint.
 * Callers (EdgeOS, InstaClaw) embed this in their runtime's MCP servers config.
 */
export const buildMcpServerConfig = (apiKey: string): McpServerConfig => ({
  name: 'index',
  url: `${(process.env.BASE_URL || 'https://protocol.index.network').replace(/\/+$/, '')}/mcp`,
  headers: { 'x-api-key': apiKey },
});
