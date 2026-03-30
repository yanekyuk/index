import { describe, it, expect, beforeAll, afterAll } from "bun:test";

import { parseArgs } from "../src/args.parser";

// ── Argument parsing tests ────────────────────────────────────────

describe("parseArgs — conversation command", () => {
  it("parses 'conversation' with no subcommand as conversation-help", () => {
    const result = parseArgs(["conversation"]);
    expect(result.command).toBe("conversation");
    expect(result.subcommand).toBeUndefined();
  });

  it("parses 'conversation list'", () => {
    const result = parseArgs(["conversation", "list"]);
    expect(result.command).toBe("conversation");
    expect(result.subcommand).toBe("list");
  });

  it("parses 'conversation with <user-id>'", () => {
    const result = parseArgs(["conversation", "with", "user-abc-123"]);
    expect(result.command).toBe("conversation");
    expect(result.subcommand).toBe("with");
    expect(result.positionals).toEqual(["user-abc-123"]);
  });

  it("parses 'conversation show <id>'", () => {
    const result = parseArgs(["conversation", "show", "conv-abc-123"]);
    expect(result.command).toBe("conversation");
    expect(result.subcommand).toBe("show");
    expect(result.positionals).toEqual(["conv-abc-123"]);
  });

  it("parses 'conversation show <id> --limit 5'", () => {
    const result = parseArgs(["conversation", "show", "conv-abc-123", "--limit", "5"]);
    expect(result.command).toBe("conversation");
    expect(result.subcommand).toBe("show");
    expect(result.positionals).toEqual(["conv-abc-123"]);
    expect(result.limit).toBe(5);
  });

  it("parses 'conversation send <id> <message>'", () => {
    const result = parseArgs(["conversation", "send", "conv-abc-123", "Hello", "there"]);
    expect(result.command).toBe("conversation");
    expect(result.subcommand).toBe("send");
    expect(result.positionals).toEqual(["conv-abc-123", "Hello", "there"]);
  });

  it("parses 'conversation stream'", () => {
    const result = parseArgs(["conversation", "stream"]);
    expect(result.command).toBe("conversation");
    expect(result.subcommand).toBe("stream");
  });

  it("parses 'conversation list --api-url <url>'", () => {
    const result = parseArgs(["conversation", "list", "--api-url", "http://localhost:4000"]);
    expect(result.command).toBe("conversation");
    expect(result.subcommand).toBe("list");
    expect(result.apiUrl).toBe("http://localhost:4000");
  });
});
