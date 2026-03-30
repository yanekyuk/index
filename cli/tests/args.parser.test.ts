import { describe, it, expect } from "bun:test";

import { parseArgs, type ParsedCommand } from "../src/args.parser";

describe("parseArgs", () => {
  it("parses 'login' command", () => {
    const result = parseArgs(["login"]);
    expect(result.command).toBe("login");
  });

  it("parses 'chat' with no args as REPL mode", () => {
    const result = parseArgs(["chat"]);
    expect(result.command).toBe("chat");
    expect(result.message).toBeUndefined();
    expect(result.sessionId).toBeUndefined();
    expect(result.list).toBe(false);
  });

  it("parses 'chat' with message as one-shot mode", () => {
    const result = parseArgs(["chat", "hello world"]);
    expect(result.command).toBe("chat");
    expect(result.message).toBe("hello world");
  });

  it("parses 'chat --list'", () => {
    const result = parseArgs(["chat", "--list"]);
    expect(result.command).toBe("chat");
    expect(result.list).toBe(true);
  });

  it("parses 'chat --session <id>'", () => {
    const result = parseArgs(["chat", "--session", "abc-123"]);
    expect(result.command).toBe("chat");
    expect(result.sessionId).toBe("abc-123");
  });

  it("parses 'chat --session <id> <message>'", () => {
    const result = parseArgs(["chat", "--session", "abc-123", "hello"]);
    expect(result.command).toBe("chat");
    expect(result.sessionId).toBe("abc-123");
    expect(result.message).toBe("hello");
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

  it("parses 'chat --api-url <url>'", () => {
    const result = parseArgs(["chat", "--api-url", "http://localhost:4000"]);
    expect(result.command).toBe("chat");
    expect(result.apiUrl).toBe("http://localhost:4000");
  });

  it("parses 'login --api-url <url>'", () => {
    const result = parseArgs(["login", "--api-url", "http://example.com"]);
    expect(result.command).toBe("login");
    expect(result.apiUrl).toBe("http://example.com");
  });
});
