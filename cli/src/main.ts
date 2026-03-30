#!/usr/bin/env node
/**
 * Index CLI — thin dispatcher that parses arguments, authenticates,
 * and delegates to the appropriate command handler module.
 *
 * Each command lives in its own `*.command.ts` file following the
 * `handleX(client, ...)` pattern.
 */

import { execFile } from "node:child_process";

import { parseArgs } from "./args.parser";
import { CredentialStore } from "./auth.store";
import { ApiClient } from "./api.client";
import { handleLogin } from "./login.command";
import { handleProfile } from "./profile.command";
import { handleIntent } from "./intent.command";
import { handleOpportunity } from "./opportunity.command";
import { handleNetwork } from "./network.command";
import { handleConversation } from "./conversation.command";
import * as output from "./output";

const DEFAULT_API_URL = "https://protocol.index.network";
const DEFAULT_APP_URL = "https://index.network";
const VERSION = "0.7.0";

const HELP_TEXT = `
Index CLI v${VERSION}

Usage:
  index login                           Authenticate via browser (uses existing session or OAuth)
  index login --token <token>           Authenticate with a manually provided token
  index logout                          Clear stored session
  index conversation                    Chat with the AI agent (interactive REPL)
  index conversation "message"          One-shot message to the AI agent
  index conversation --session <id>     Resume a specific chat session
  index conversation sessions           List AI chat sessions
  index conversation list               List all conversations (H2A + H2H)
  index conversation with <user-id>     Open or resume a DM with a user
  index conversation show <id>          Show messages in a conversation
  index conversation send <id> <msg>    Send a message
  index conversation stream             Listen for real-time events (SSE)
  index profile                         Show your profile
  index profile show <user-id>          Show another user's profile
  index profile sync                    Regenerate your profile
  index intent list [--archived] [--limit <n>]  List your signals
  index intent show <id>               Show signal details
  index intent create <content>        Create a signal from natural language
  index intent archive <id>            Archive a signal
  index opportunity list                List your opportunities
  index opportunity list --status <s>   Filter by status (pending|accepted|rejected|expired)
  index opportunity list --limit <n>    Limit results
  index opportunity show <id>           Show full opportunity details
  index opportunity accept <id>         Accept an opportunity
  index opportunity reject <id>         Reject an opportunity
  index network list                    List your networks
  index network create <name>           Create a new network
  index network show <id>               Show network details and members
  index network join <id>               Join a public network
  index network leave <id>              Leave a network
  index network invite <id> <email>     Invite a user by email
  index --help                          Show this help message
  index --version                       Show version

Options:
  --api-url <url>     Override the API server URL (default: ${DEFAULT_API_URL})
  --app-url <url>     Override the app URL for login (default: ${DEFAULT_APP_URL})
  --token <token>, -t Provide a bearer token directly (skips browser flow)
  --session <id>, -s  Resume a specific chat session
  --archived          Include archived signals (intent list)
  --status <status>   Filter opportunities by status
  --limit <n>         Limit number of results
`;

// ── Auth helper ──────────────────────────────────────────────────────

/**
 * Load stored auth and return an API client, or exit with an error.
 *
 * @param apiUrlOverride - Optional API URL override from --api-url flag.
 * @returns Authenticated API client.
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

// ── Login / Logout ──────────────────────────────────────────────────

/**
 * Handle the login command — supports both browser OAuth and manual token.
 */
async function runLogin(apiUrlOverride?: string, appUrlOverride?: string, manualToken?: string): Promise<void> {
  const store = new CredentialStore();
  const apiUrl = apiUrlOverride ?? DEFAULT_API_URL;
  const appUrl = appUrlOverride ?? DEFAULT_APP_URL;

  // Manual token flow: skip browser entirely
  if (manualToken) {
    await store.save({ token: manualToken, apiUrl });
    try {
      const client = new ApiClient(apiUrl, manualToken);
      const user = await client.getMe();
      output.success(`Logged in as ${user.name} (${user.email})`);
    } catch {
      output.success("Token stored. Could not verify — check with `index conversation`.");
    }
    return;
  }

  // Browser flow: opens /cli-auth which exchanges existing session or starts OAuth
  output.info(`Authenticating with ${apiUrl}...`);

  const { authUrl, callbackPromise } = await handleLogin(apiUrl, appUrl, store);

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
      execFile(opener, [authUrl], { stdio: "ignore" });
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

/**
 * Handle the logout command — clear stored session.
 */
async function runLogout(): Promise<void> {
  const store = new CredentialStore();
  await store.clear();
  output.success("Logged out. Session cleared.");
}

// ── Main dispatcher ─────────────────────────────────────────────────

/**
 * Main CLI entry point — parses args, authenticates when needed,
 * and dispatches to the appropriate command handler.
 */
async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  // Commands that don't require authentication
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
      await runLogin(args.apiUrl, args.appUrl, args.token);
      return;
    case "logout":
      await runLogout();
      return;
  }

  // All remaining commands require authentication
  const client = await requireAuth(args.apiUrl);

  switch (args.command) {
    case "profile":
      await handleProfile(client, args.subcommand, args.userId ? [args.userId] : []);
      return;
    case "intent":
      await handleIntent(client, args.subcommand, {
        intentId: args.intentId,
        intentContent: args.intentContent,
        archived: args.archived,
        limit: args.limit,
      });
      return;
    case "opportunity":
      await handleOpportunity(client, args.subcommand, {
        targetId: args.targetId,
        status: args.status,
        limit: args.limit,
      });
      return;
    case "network":
      await handleNetwork(client, args.subcommand, args.positionals ?? [], {
        prompt: args.prompt,
      });
      return;
    case "conversation":
      await handleConversation(client, args.subcommand, args.positionals ?? [], {
        limit: args.limit,
        sessionId: args.sessionId,
        message: args.message,
      });
      return;
  }
}

// ── Run ──────────────────────────────────────────────────────────────

main().catch((err) => {
  output.error(err instanceof Error ? err.message : String(err), 1);
});
