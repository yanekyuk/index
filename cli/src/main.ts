#!/usr/bin/env bun
/**
 * Index CLI — command-line interface for Index Network.
 *
 * Usage:
 *   index login                    Authenticate via browser OAuth
 *   index logout                   Clear stored session
 *   index chat [message]           Start or continue an H2A chat session
 *   index chat --list              List chat sessions
 *   index chat --session <id>      Resume a specific session
 *   index --help                   Show this help message
 *   index --version                Show version
 */

import { createInterface } from "node:readline/promises";

import { parseArgs } from "./args.parser";
import { CredentialStore } from "./auth.store";
import { ApiClient } from "./api.client";
import { handleLogin } from "./login.command";
import { renderSSEStream } from "./chat.command";
import * as output from "./output";

const DEFAULT_API_URL = "http://localhost:3000";
const VERSION = "0.1.0";

const HELP_TEXT = `
Index CLI v${VERSION}

Usage:
  index login                           Authenticate via browser (uses existing session or OAuth)
  index login --token <token>           Authenticate with a manually provided token
  index logout                          Clear stored session
  index chat [message]                  Chat with the AI agent (REPL if no message)
  index chat --list                     List chat sessions
  index chat --session <id> [message]   Resume a specific session
  index --help                          Show this help message
  index --version                       Show version

Options:
  --api-url <url>     Override the API server URL (default: ${DEFAULT_API_URL})
  --token <token>, -t Provide a bearer token directly (skips browser flow)
  --session <id>, -s  Resume a specific chat session
  --list, -l          List chat sessions
`;

/**
 * Main CLI entry point.
 */
async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  switch (args.command) {
    case "help":
      console.log(HELP_TEXT);
      return;

    case "version":
      console.log(VERSION);
      return;

    case "unknown":
      output.error(`Unknown command: ${args.unknown}`, 1);
      return;

    case "login":
      await runLogin(args.apiUrl, args.token);
      return;

    case "logout":
      await runLogout();
      return;

    case "chat":
      if (args.list) {
        await runChatList(args.apiUrl);
      } else if (args.message) {
        await runChatOneShot(args.message, args.sessionId, args.apiUrl);
      } else {
        await runChatRepl(args.sessionId, args.apiUrl);
      }
      return;
  }
}

// ── Command handlers ─────────────────────────────────────────────────

async function runLogin(apiUrlOverride?: string, manualToken?: string): Promise<void> {
  const store = new CredentialStore();
  const apiUrl = apiUrlOverride ?? DEFAULT_API_URL;

  // Manual token flow: skip browser entirely
  if (manualToken) {
    await store.save({ token: manualToken, apiUrl });
    try {
      const client = new ApiClient(apiUrl, manualToken);
      const user = await client.getMe();
      output.success(`Logged in as ${user.name} (${user.email})`);
    } catch {
      output.success("Token stored. Could not verify — check with `index chat`.");
    }
    return;
  }

  // Browser flow: opens /cli-auth which exchanges existing session or starts OAuth
  output.info(`Authenticating with ${apiUrl}...`);

  const { authUrl, callbackPromise } = await handleLogin(apiUrl, store);

  output.info("Opening browser for authentication...");
  output.dim(`If the browser does not open, visit:\n  ${authUrl}\n`);

  try {
    const opener =
      process.platform === "darwin"
        ? "open"
        : process.platform === "linux"
          ? "xdg-open"
          : null;

    if (opener) {
      Bun.spawn([opener, authUrl], { stdout: "ignore", stderr: "ignore" });
    }
  } catch {
    // Browser open failed — user can copy the URL manually.
  }

  output.dim("Waiting for authentication callback...");
  const result = await callbackPromise;

  if (result.success) {
    try {
      const creds = await store.load();
      if (creds) {
        const client = new ApiClient(creds.apiUrl, creds.token);
        const user = await client.getMe();
        output.success(`Logged in as ${user.name} (${user.email})`);
      }
    } catch {
      output.success("Login successful! Token stored.");
    }
  } else {
    output.error(result.error ?? "Login failed.", 1);
  }
}

async function runLogout(): Promise<void> {
  const store = new CredentialStore();
  await store.clear();
  output.success("Logged out. Session cleared.");
}

async function runChatList(apiUrlOverride?: string): Promise<void> {
  const client = await requireAuth(apiUrlOverride);

  const sessions = await client.listSessions();
  output.heading("Chat Sessions");
  output.sessionTable(sessions);
  console.log();
}

async function runChatOneShot(
  message: string,
  sessionId?: string,
  apiUrlOverride?: string,
): Promise<void> {
  const client = await requireAuth(apiUrlOverride);

  const response = await client.streamChat({ message, sessionId });

  if (!response.ok) {
    handleStreamError(response);
    return;
  }

  const result = await streamToTerminal(response);

  if (result.error) {
    output.error(result.error, 1);
    return;
  }

  if (result.sessionId) {
    output.dim(`\nSession: ${result.sessionId}`);
  }
}

async function runChatRepl(
  sessionId?: string,
  apiUrlOverride?: string,
): Promise<void> {
  const client = await requireAuth(apiUrlOverride);
  let currentSessionId = sessionId;

  output.chatHeader();

  const PROMPT_STR = output.PROMPT_STR;

  const rl = createInterface({
    input: process.stdin,
    output: process.stderr,
    terminal: true,
  });
  rl.setPrompt(PROMPT_STR);
  rl.prompt();

  try {
    for await (const line of rl) {
      const input = line.trim();
      if (!input) {
        rl.prompt();
        continue;
      }
      if (input === "exit" || input === "quit") break;

      const response = await client.streamChat({
        message: input,
        sessionId: currentSessionId,
      });

      if (!response.ok) {
        if (response.status === 401) {
          output.error(
            "Session expired. Run `index login` to re-authenticate.",
            1,
          );
          return;
        }
        const body = (await response.json().catch(() => ({}))) as {
          error?: string;
        };
        output.error(body.error ?? `HTTP ${response.status}`);
        rl.prompt();
        continue;
      }

      const result = await streamToTerminal(response);

      if (result.error) {
        output.error(result.error);
      }

      // Track session for continuity
      if (result.sessionId) {
        currentSessionId = result.sessionId;
      }

      process.stderr.write("\n");
      rl.prompt();
    }
  } finally {
    rl.close();
  }

  process.stderr.write("\n");
  output.dim("Goodbye!");
}

// ── Stream helpers ──────────────────────────────────────────────────

import type { StreamResult } from "./chat.command";
import { MarkdownRenderer } from "./output";

/**
 * Stream an SSE response to the terminal with formatting.
 * Handles status messages, tool activity, and markdown rendering.
 */
async function streamToTerminal(response: Response): Promise<StreamResult> {
  let hasTokens = false;
  const md = new MarkdownRenderer();
  let lastToolDesc = "";

  const result = await renderSSEStream(response, {
    onToken(text) {
      if (!hasTokens) {
        output.clearStatus();
        hasTokens = true;
      }
      md.write(text);
      // Once tokens flow, clear last tool so it can show again after new text
      lastToolDesc = "";
    },
    onStatus(msg) {
      if (!hasTokens) {
        output.status(msg);
      }
    },
    onToolActivity(description, phase) {
      if (phase === "start") {
        const friendly = output.humanizeToolName(description);
        // Skip if identical to the last tool line with no text in between
        if (friendly === lastToolDesc) return;
        lastToolDesc = friendly;
        // Finalize any buffered markdown before the tool line
        md.finalize();
        hasTokens = false;
        output.toolActivity(friendly);
      }
    },
    onResponseReset(reason) {
      md.reset(reason);
      hasTokens = false;
    },
  });

  md.finalize();
  output.clearStatus();
  if (hasTokens) {
    console.log(); // newline after streamed tokens
  }

  return result;
}

/** Handle non-OK stream responses. */
async function handleStreamError(response: Response): Promise<void> {
  if (response.status === 401) {
    output.error(
      "Session expired or invalid. Run `index login` to re-authenticate.",
      1,
    );
  }
  const body = (await response.json().catch(() => ({}))) as {
    error?: string;
  };
  output.error(body.error ?? `HTTP ${response.status}`, 1);
}

// ── Auth helper ──────────────────────────────────────────────────────

/**
 * Load stored auth and return an API client, or exit with an error.
 */
async function requireAuth(apiUrlOverride?: string): Promise<ApiClient> {
  const store = new CredentialStore();
  const creds = await store.load();

  if (!creds) {
    output.error("Not logged in. Run `index login` first.", 1);
    process.exit(1); // TypeScript needs this for never return
  }

  const apiUrl = apiUrlOverride ?? creds.apiUrl;
  return new ApiClient(apiUrl, creds.token);
}

// ── Run ──────────────────────────────────────────────────────────────

main().catch((err) => {
  output.error(err instanceof Error ? err.message : String(err), 1);
});
