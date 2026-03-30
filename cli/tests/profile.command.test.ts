import { describe, it, expect } from "bun:test";

import { parseArgs } from "../src/args.parser";

describe("parseArgs — profile command", () => {
  it("parses 'profile' with no args as view-own", () => {
    const result = parseArgs(["profile"]);
    expect(result.command).toBe("profile");
    expect(result.subcommand).toBeUndefined();
    expect(result.userId).toBeUndefined();
  });

  it("parses 'profile show <user-id>'", () => {
    const result = parseArgs(["profile", "show", "user-abc-123"]);
    expect(result.command).toBe("profile");
    expect(result.subcommand).toBe("show");
    expect(result.userId).toBe("user-abc-123");
  });

  it("parses 'profile sync'", () => {
    const result = parseArgs(["profile", "sync"]);
    expect(result.command).toBe("profile");
    expect(result.subcommand).toBe("sync");
  });

  it("parses 'profile --api-url <url>'", () => {
    const result = parseArgs(["profile", "--api-url", "http://localhost:4000"]);
    expect(result.command).toBe("profile");
    expect(result.apiUrl).toBe("http://localhost:4000");
  });

  it("parses 'profile show <user-id> --api-url <url>'", () => {
    const result = parseArgs([
      "profile",
      "show",
      "user-abc-123",
      "--api-url",
      "http://localhost:4000",
    ]);
    expect(result.command).toBe("profile");
    expect(result.subcommand).toBe("show");
    expect(result.userId).toBe("user-abc-123");
    expect(result.apiUrl).toBe("http://localhost:4000");
  });
});
