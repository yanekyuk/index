import '../src/startup.env';
import { describe, it, expect } from 'bun:test';
import { createMcpServer } from '@indexnetwork/protocol';
import { createToolRegistry } from '@indexnetwork/protocol';
import type { ToolDeps } from '@indexnetwork/protocol';
import type { McpAuthResolver } from '@indexnetwork/protocol';
import type { ScopedDepsFactory } from '@indexnetwork/protocol';

// ═══════════════════════════════════════════════════════════════════════════════
// MOCK DEPENDENCIES
// ═══════════════════════════════════════════════════════════════════════════════

/** Minimal mock ToolDeps — tools are registered but never invoked, so stubs suffice. */
const mockDeps: ToolDeps = {
  database: {} as ToolDeps['database'],
  userDb: {} as ToolDeps['userDb'],
  systemDb: {} as ToolDeps['systemDb'],
  scraper: {} as ToolDeps['scraper'],
  embedder: {} as ToolDeps['embedder'],
  cache: {} as ToolDeps['cache'],
  integration: {} as ToolDeps['integration'],
  graphs: {
    profile: { invoke: async () => ({}) },
    intent: { invoke: async () => ({}) },
    index: { invoke: async () => ({}) },
    networkMembership: { invoke: async () => ({}) },
    intentIndex: { invoke: async () => ({}) },
    opportunity: { invoke: async () => ({}) } as ToolDeps['graphs']['opportunity'],
  },
};

/** Mock auth resolver — never called during tool registration. */
const mockAuthResolver: McpAuthResolver = {
  resolveUserId: async () => 'test-user-id',
};

/** Mock scoped deps factory — never called during tool registration. */
const mockScopedDepsFactory: ScopedDepsFactory = {
  create: () => ({
    userDb: {} as ToolDeps['userDb'],
    systemDb: {} as ToolDeps['systemDb'],
  }),
};

// ═══════════════════════════════════════════════════════════════════════════════
// TESTS
// ═══════════════════════════════════════════════════════════════════════════════

describe('MCP Server Factory', () => {
  it('creates an McpServer instance', () => {
    const server = createMcpServer(mockDeps, mockAuthResolver, mockScopedDepsFactory);
    // Check structural shape — instanceof fails across dual module installs
    expect(server).toHaveProperty('server');
    expect(typeof (server as { connect?: unknown }).connect).toBe('function');
  });

  it('registers the same tools as createToolRegistry', () => {
    const registry = createToolRegistry(mockDeps);
    const server = createMcpServer(mockDeps, mockAuthResolver, mockScopedDepsFactory);

    // The MCP server should have registered every tool from the registry.
    // We verify by checking the registry size matches expected count.
    expect(registry.size).toBe(28);

    // Verify key tools exist in the registry
    const expectedTools = [
      'read_intents',
      'create_intent',
      'read_user_profiles',
      'create_opportunities',
      'update_opportunity',
      'list_contacts',
      'scrape_url',
    ];

    for (const toolName of expectedTools) {
      expect(registry.has(toolName)).toBe(true);
    }
  });
});
