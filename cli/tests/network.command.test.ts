import { describe, it, expect } from "bun:test";

import { parseArgs } from "../src/args.parser";

describe("parseArgs — network command", () => {
  it("parses 'network' with no subcommand as network-help", () => {
    const result = parseArgs(["network"]);
    expect(result.command).toBe("network");
    expect(result.subcommand).toBeUndefined();
  });

  it("parses 'network list'", () => {
    const result = parseArgs(["network", "list"]);
    expect(result.command).toBe("network");
    expect(result.subcommand).toBe("list");
  });

  it("parses 'network create <name>'", () => {
    const result = parseArgs(["network", "create", "My Network"]);
    expect(result.command).toBe("network");
    expect(result.subcommand).toBe("create");
    expect(result.positionals).toEqual(["My Network"]);
  });

  it("parses 'network create <name> --prompt <text>'", () => {
    const result = parseArgs(["network", "create", "My Network", "--prompt", "A test network"]);
    expect(result.command).toBe("network");
    expect(result.subcommand).toBe("create");
    expect(result.positionals).toEqual(["My Network"]);
    expect(result.prompt).toBe("A test network");
  });

  it("parses 'network show <id>'", () => {
    const result = parseArgs(["network", "show", "abc-123"]);
    expect(result.command).toBe("network");
    expect(result.subcommand).toBe("show");
    expect(result.positionals).toEqual(["abc-123"]);
  });

  it("parses 'network join <id>'", () => {
    const result = parseArgs(["network", "join", "abc-123"]);
    expect(result.command).toBe("network");
    expect(result.subcommand).toBe("join");
    expect(result.positionals).toEqual(["abc-123"]);
  });

  it("parses 'network leave <id>'", () => {
    const result = parseArgs(["network", "leave", "abc-123"]);
    expect(result.command).toBe("network");
    expect(result.subcommand).toBe("leave");
    expect(result.positionals).toEqual(["abc-123"]);
  });

  it("parses 'network invite <id> <email>'", () => {
    const result = parseArgs(["network", "invite", "abc-123", "user@example.com"]);
    expect(result.command).toBe("network");
    expect(result.subcommand).toBe("invite");
    expect(result.positionals).toEqual(["abc-123", "user@example.com"]);
  });

  it("parses 'network list --api-url <url>'", () => {
    const result = parseArgs(["network", "list", "--api-url", "http://localhost:4000"]);
    expect(result.command).toBe("network");
    expect(result.subcommand).toBe("list");
    expect(result.apiUrl).toBe("http://localhost:4000");
  });
});
