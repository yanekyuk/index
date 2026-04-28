const DEFAULT_PROTOCOL_URL = import.meta.env.DEV
  ? "http://localhost:3001"
  : "https://api.index.network";
const PROTOCOL_URL = import.meta.env.VITE_PROTOCOL_URL || DEFAULT_PROTOCOL_URL;
const MCP_URL = `${PROTOCOL_URL}/mcp`;

export const OPENCLAW_INSTALL_CMD =
  "openclaw plugins install indexnetwork-openclaw-plugin --marketplace https://github.com/indexnetwork/openclaw-plugin";
export const OPENCLAW_UPDATE_CMD = "openclaw plugins update indexnetwork-openclaw-plugin";
export const OPENCLAW_SETUP_CMD = "openclaw index-network setup";
export const OPENCLAW_GATEWAY_RESTART_CMD = "openclaw gateway restart";

function yamlDoubleQuoted(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

export interface McpConfigs {
  mcpUrl: string;
  claudeConfig: string;
  hermesConfig: string;
}

export function buildMcpConfigs(apiKey: string): McpConfigs {
  const claudeConfig = JSON.stringify(
    {
      mcpServers: {
        "index-network": {
          type: "http",
          url: MCP_URL,
          headers: { "x-api-key": apiKey },
        },
      },
    },
    null,
    2,
  );

  const hermesConfig = `mcp_servers:
  - name: index-network
    url: ${yamlDoubleQuoted(MCP_URL)}
    headers:
      x-api-key: ${yamlDoubleQuoted(apiKey)}`;

  return { mcpUrl: MCP_URL, claudeConfig, hermesConfig };
}
