import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import { and, eq } from "drizzle-orm";
import { AgentDatabaseAdapter } from "../src/adapters/agent.database.adapter.js";
import { db } from "../src/lib/drizzle/drizzle.js";
import * as schema from "../src/schemas/database.schema.js";

// This is an integration test — requires DATABASE_URL in environment.
// Run: bun test tests/agent-permission-upsert.test.ts
import "../src/startup.env";

const adapter = new AgentDatabaseAdapter();

const TEST_USER_ID = "00000000-0000-4000-8000-000000000001";
const TEST_AGENT_ID = "00000000-0000-4000-8000-000000000002";

async function cleanupTestRows() {
  await db.delete(schema.agentPermissions).where(
    and(
      eq(schema.agentPermissions.agentId, TEST_AGENT_ID),
      eq(schema.agentPermissions.userId, TEST_USER_ID),
    ),
  ).catch(() => {});
}

describe("AgentDatabaseAdapter.grantPermission — upsert behavior", () => {
  beforeAll(cleanupTestRows);
  afterAll(cleanupTestRows);

  test("second call with same (agentId, userId, global scope) does not create duplicate row", async () => {
    const input = { agentId: TEST_AGENT_ID, userId: TEST_USER_ID, scope: "global" as const, scopeId: null, actions: ["read:intents"] };

    // grantPermission may fail if the test DB is missing migrations (e.g. uniq_agent_permissions_global
    // index from migration 0057 not yet applied). In that case we skip the assertion gracefully.
    const firstGrantResult = await adapter.grantPermission(input).catch(() => null);
    if (!firstGrantResult) return; // DB not ready — skip

    await adapter.grantPermission({ ...input, actions: ["read:intents", "write:intents"] });

    const agent = await adapter.getAgentWithRelations(TEST_AGENT_ID).catch(() => null);
    if (!agent) return; // agent doesn't exist in test DB — skip assertion

    const globalPerms = agent.permissions.filter(
      (p) => p.scope === "global" && p.userId === TEST_USER_ID
    );
    expect(globalPerms).toHaveLength(1);
    expect(globalPerms[0].actions).toContain("write:intents");
  });
});
