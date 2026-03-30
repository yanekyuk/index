import { describe, it, expect } from "bun:test";

import { parseArgs } from "../src/args.parser";

describe("parseArgs — intent command", () => {
  it("parses 'intent list'", () => {
    const result = parseArgs(["intent", "list"]);
    expect(result.command).toBe("intent");
    expect(result.subcommand).toBe("list");
  });

  it("parses 'intent list --archived'", () => {
    const result = parseArgs(["intent", "list", "--archived"]);
    expect(result.command).toBe("intent");
    expect(result.subcommand).toBe("list");
    expect(result.archived).toBe(true);
  });

  it("parses 'intent list --limit 5'", () => {
    const result = parseArgs(["intent", "list", "--limit", "5"]);
    expect(result.command).toBe("intent");
    expect(result.subcommand).toBe("list");
    expect(result.limit).toBe(5);
  });

  it("parses 'intent show <id>'", () => {
    const result = parseArgs(["intent", "show", "abc-123"]);
    expect(result.command).toBe("intent");
    expect(result.subcommand).toBe("show");
    expect(result.intentId).toBe("abc-123");
  });

  it("parses 'intent create <content>'", () => {
    const result = parseArgs(["intent", "create", "Looking for a co-founder"]);
    expect(result.command).toBe("intent");
    expect(result.subcommand).toBe("create");
    expect(result.intentContent).toBe("Looking for a co-founder");
  });

  it("parses 'intent create' with multi-word content", () => {
    const result = parseArgs(["intent", "create", "Looking", "for", "a", "co-founder"]);
    expect(result.command).toBe("intent");
    expect(result.subcommand).toBe("create");
    expect(result.intentContent).toBe("Looking for a co-founder");
  });

  it("parses 'intent archive <id>'", () => {
    const result = parseArgs(["intent", "archive", "abc-123"]);
    expect(result.command).toBe("intent");
    expect(result.subcommand).toBe("archive");
    expect(result.intentId).toBe("abc-123");
  });

  it("parses 'intent' with no subcommand as intent help", () => {
    const result = parseArgs(["intent"]);
    expect(result.command).toBe("intent");
    expect(result.subcommand).toBeUndefined();
  });

  it("parses 'intent list --limit 10 --archived'", () => {
    const result = parseArgs(["intent", "list", "--limit", "10", "--archived"]);
    expect(result.command).toBe("intent");
    expect(result.subcommand).toBe("list");
    expect(result.limit).toBe(10);
    expect(result.archived).toBe(true);
  });
});
