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
import { handleContact } from "./contact.command";
import { handleScrape } from "./scrape.command";
import { handleSync } from "./sync.command";
import { handleOnboarding } from "./onboarding.command";
import * as output from "./output";

const DEFAULT_API_URL = "https://protocol.index.network";
const DEFAULT_APP_URL = "https://index.network";
const VERSION = "0.9.5";

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
  index profile search <query>          Search user profiles
  index profile create [--linkedin <url>] [--github <url>] [--twitter <url>]
                                        Create your profile from social URLs
  index profile update <action> [--details <text>]
                                        Update your profile
  index intent list [--archived] [--limit <n>]  List your signals
  index intent show <id>               Show signal details
  index intent create <content>        Create a signal from natural language
  index intent update <id> <content>   Update a signal's description
  index intent archive <id>            Archive a signal
  index intent link <id> <network-id>  Link a signal to a network
  index intent unlink <id> <network-id> Unlink a signal from a network
  index intent links <id>              Show linked networks for a signal
  index opportunity list                List your opportunities
  index opportunity list --status <s>   Filter by status (pending|accepted|rejected|expired)
  index opportunity list --limit <n>    Limit results
  index opportunity show <id>           Show full opportunity details
  index opportunity accept <id>         Accept an opportunity
  index opportunity reject <id>         Reject an opportunity
  index opportunity discover <query>    Discover opportunities by search query
  index network list                    List your networks
  index network create <name>           Create a new network
  index network show <id>               Show network details and members
  index network update <id> [--title <t>] [--prompt <p>]
                                        Update a network
  index network delete <id>             Delete a network
  index network join <id>               Join a public network
  index network leave <id>              Leave a network
  index network invite <id> <email>     Invite a user by email
  index contact list                    List your contacts
  index contact add <email>             Add a contact by email
  index contact remove <email>          Remove a contact
  index contact import --gmail          Import contacts from Gmail
  index scrape <url>                    Extract content from a URL
  index onboarding complete             Mark onboarding as complete
  index sync                            Sync context to ~/.index/context.json
  index sync --json                     Output synced context to stdout
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
  --json              Output raw JSON instead of formatted text
  --name <name>       Name for contact add
  --gmail             Import source flag for contact import
  --objective <text>  Objective for scrape command
  --target <uid>      Target user for opportunity discover
  --introduce <uid>   Source user for introduction discovery
  --linkedin <url>    LinkedIn URL for profile create
  --github <url>      GitHub URL for profile create
  --twitter <url>     Twitter URL for profile create
  --title <text>      Title for network update
  --details <text>    Details for profile update
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
      await handleProfile(
        client,
        args.subcommand,
        args.subcommand === "search" || args.subcommand === "update"
          ? (args.positionals ?? [])
          : (args.userId ? [args.userId] : []),
        {
          json: args.json,
          linkedin: args.linkedin,
          github: args.github,
          twitter: args.twitter,
          details: args.details,
        },
      );
      return;
    case "intent":
      await handleIntent(client, args.subcommand, {
        intentId: args.intentId,
        intentContent: args.intentContent,
        archived: args.archived,
        limit: args.limit,
        json: args.json,
        targetId: args.targetId,
      });
      return;
    case "opportunity":
      await handleOpportunity(client, args.subcommand, {
        targetId: args.targetId,
        status: args.status,
        limit: args.limit,
        json: args.json,
        positionals: args.positionals,
        target: args.target,
        introduce: args.introduce,
      });
      return;
    case "network":
      await handleNetwork(client, args.subcommand, args.positionals ?? [], {
        prompt: args.prompt,
        title: args.title,
        json: args.json,
      });
      return;
    case "conversation":
      await handleConversation(client, args.subcommand, args.positionals ?? [], {
        limit: args.limit,
        sessionId: args.sessionId,
        message: args.message,
        json: args.json,
      });
      return;
    case "contact":
      await handleContact(client, args.subcommand, args.positionals ?? [], {
        json: args.json,
        name: args.name,
        gmail: args.gmail,
      });
      return;
    case "scrape":
      await handleScrape(client, args.positionals ?? [], {
        json: args.json,
        objective: args.objective,
      });
      return;
    case "onboarding":
      await handleOnboarding(client, args.subcommand, { json: args.json });
      return;
    case "sync":
      await handleSync(client, { json: args.json });
      return;
  }
}

// ── Run ──────────────────────────────────────────────────────────────

main().catch((err) => {
  output.error(err instanceof Error ? err.message : String(err), 1);
});
