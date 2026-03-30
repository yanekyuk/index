import { describe, it, expect } from "bun:test";

import { parseArgs, type ParsedCommand } from "../src/args.parser";

describe("parseArgs", () => {
  it("parses 'login' command", () => {
    const result = parseArgs(["login"]);
    expect(result.command).toBe("login");
  });

  it("parses 'conversation' with no args as REPL mode", () => {
    const result = parseArgs(["conversation"]);
    expect(result.command).toBe("conversation");
    expect(result.message).toBeUndefined();
    expect(result.subcommand).toBeUndefined();
  });

  it("parses 'conversation' with message as one-shot mode", () => {
    const result = parseArgs(["conversation", "hello world"]);
    expect(result.command).toBe("conversation");
    expect(result.message).toBe("hello world");
  });

  it("parses 'conversation sessions'", () => {
    const result = parseArgs(["conversation", "sessions"]);
    expect(result.command).toBe("conversation");
    expect(result.subcommand).toBe("sessions");
  });

  it("parses 'conversation --session <id>'", () => {
    const result = parseArgs(["conversation", "--session", "abc-123"]);
    expect(result.command).toBe("conversation");
    expect(result.sessionId).toBe("abc-123");
  });

  it("parses 'conversation --session <id> <message>'", () => {
    const result = parseArgs(["conversation", "--session", "abc-123", "hello"]);
    expect(result.command).toBe("conversation");
    expect(result.sessionId).toBe("abc-123");
    expect(result.message).toBe("hello");
  });

  it("treats 'chat' as unknown command", () => {
    const result = parseArgs(["chat"]);
    expect(result.command).toBe("unknown");
    expect(result.unknown).toBe("chat");
  });

  it("parses '--help' flag", () => {
    const result = parseArgs(["--help"]);
    expect(result.command).toBe("help");
  });

  it("parses 'help' command", () => {
    const result = parseArgs(["help"]);
    expect(result.command).toBe("help");
  });

  it("parses '--version' flag", () => {
    const result = parseArgs(["--version"]);
    expect(result.command).toBe("version");
  });

  it("parses 'logout' command", () => {
    const result = parseArgs(["logout"]);
    expect(result.command).toBe("logout");
  });

  it("returns help for empty args", () => {
    const result = parseArgs([]);
    expect(result.command).toBe("help");
  });

  it("returns unknown for unrecognized command", () => {
    const result = parseArgs(["foobar"]);
    expect(result.command).toBe("unknown");
    expect(result.unknown).toBe("foobar");
  });

  it("parses 'conversation --api-url <url>'", () => {
    const result = parseArgs(["conversation", "--api-url", "http://localhost:4000"]);
    expect(result.command).toBe("conversation");
    expect(result.apiUrl).toBe("http://localhost:4000");
  });

  it("parses 'login --api-url <url>'", () => {
    const result = parseArgs(["login", "--api-url", "http://example.com"]);
    expect(result.command).toBe("login");
    expect(result.apiUrl).toBe("http://example.com");
  });
});
