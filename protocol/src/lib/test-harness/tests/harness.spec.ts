import { config } from "dotenv";
config({ path: ".env.test" });

import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { sql } from "drizzle-orm";
import { createTestHarness } from "../harness";

describe("createTestHarness", () => {
  const harness = createTestHarness();

  beforeAll(async () => {
    await harness.setup();
  });

  afterAll(async () => {
    await harness.teardown();
  });

  it("provides a working database connection", async () => {
    const result = await harness.db.execute(sql.raw("SELECT 1 as n"));
    expect(result).toBeDefined();
  });

  it("provides an embedder", () => {
    expect(harness.embedder).toBeDefined();
    expect(typeof harness.embedder.generate).toBe("function");
  });

  it("reset truncates tables without error", async () => {
    await harness.reset();
  });
});
