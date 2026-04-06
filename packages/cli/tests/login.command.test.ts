import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { CredentialStore } from "../src/auth.store";
import { handleLogin } from "../src/login.command";

describe("handleLogin", () => {
  let tempDir: string;
  let store: CredentialStore;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "index-cli-login-"));
    store = new CredentialStore(tempDir);
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("starts a local callback server and returns the auth URL", async () => {
    const apiUrl = "http://localhost:3001";
    const controller = new AbortController();

    const { authUrl, port, callbackPromise } = await handleLogin(apiUrl, apiUrl, store, {
      signal: controller.signal,
    });

    expect(authUrl).toContain(apiUrl);
    expect(authUrl).toContain("/cli-auth");
    expect(authUrl).toContain("callback=");
    expect(port).toBeGreaterThan(0);

    // Clean up — abort the callback server
    controller.abort();
    // Wait for the promise to settle after abort
    await callbackPromise.catch(() => {});
  });

  it("saves tokens when callback is received", async () => {
    const apiUrl = "http://localhost:3001";
    const controller = new AbortController();

    const { port, callbackPromise } = await handleLogin(apiUrl, apiUrl, store, {
      signal: controller.signal,
    });

    // Simulate the OAuth callback with a mock token exchange
    // The callback server expects a GET with a session token
    const callbackUrl = `http://localhost:${port}/callback?session_token=mock-jwt-token`;
    await fetch(callbackUrl);

    // Wait a moment for the handler to complete
    const result = await callbackPromise;
    expect(result.success).toBe(true);

    const savedCreds = await store.load();
    expect(savedCreds).not.toBeNull();
    expect(savedCreds?.token).toBe("mock-jwt-token");
    expect(savedCreds?.apiUrl).toBe(apiUrl);
  });

  it("times out if no callback is received", async () => {
    const apiUrl = "http://localhost:3001";
    const controller = new AbortController();

    const { callbackPromise } = await handleLogin(apiUrl, apiUrl, store, {
      signal: controller.signal,
      timeoutMs: 200, // Short timeout for test
    });

    const result = await callbackPromise;
    expect(result.success).toBe(false);
    expect(result.error).toContain("timed out");
  });
});
