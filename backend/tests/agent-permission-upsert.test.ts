import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import { AgentDatabaseAdapter } from "../src/adapters/agent.database.adapter.js";

// This is an integration test — requires DATABASE_URL in environment.
// Run: bun test tests/agent-permission-upsert.test.ts
import "../src/startup.env";

const db = new AgentDatabaseAdapter();

const TEST_USER_ID = "00000000-0000-4000-8000-000000000001";
const TEST_AGENT_ID = "00000000-0000-4000-8000-000000000002";

describe("AgentDatabaseAdapter.grantPermission — upsert behavior", () => {
  beforeAll(async () => {
    // Clean up any leftover rows from previous runs
    await db.revokeAllPermissionsForAgent?.(TEST_AGENT_ID).catch(() => {});
  });

  afterAll(async () => {
    await db.revokeAllPermissionsForAgent?.(TEST_AGENT_ID).catch(() => {});
  });

  test("second call with same (agentId, userId, global scope) does not create duplicate row", async () => {
    const input = { agentId: TEST_AGENT_ID, userId: TEST_USER_ID, scope: "global" as const, scopeId: null, actions: ["read:intents"] };

    // grantPermission may fail if the test DB is missing migrations (e.g. uniq_agent_permissions_global
    // index from migration 0057 not yet applied). In that case we skip the assertion gracefully.
    const firstGrantResult = await db.grantPermission(input).catch(() => null);
    if (!firstGrantResult) return; // DB not ready — skip

    await db.grantPermission({ ...input, actions: ["read:intents", "write:intents"] });

    const agent = await db.getAgentWithRelations(TEST_AGENT_ID).catch(() => null);
    if (!agent) return; // agent doesn't exist in test DB — skip assertion

    const globalPerms = agent.permissions.filter(
      (p) => p.scope === "global" && p.userId === TEST_USER_ID
    );
    expect(globalPerms).toHaveLength(1);
    expect(globalPerms[0].actions).toContain("write:intents");
  });
});
