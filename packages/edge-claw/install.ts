#!/usr/bin/env bun
/**
 * Edge Claw installer.
 *
 * Pre-stages OpenClaw config and the Edge Claw workspace so the agent comes
 * online with a single chat turn. The installer owns everything that does not
 * belong in a runtime prompt:
 *
 *   - Writes `mcp.servers.index` to the canonical production protocol URL
 *     with the user's API key.
 *   - Disables Telegram progress-draft "tidepooling" so the streaming-off
 *     setting is loaded on the very first gateway start (not deferred until
 *     the first bootstrap turn drains).
 *   - Cleans up legacy `mcp.servers.index-network` entries from pre-0.22.0
 *     OpenClaw-plugin installs.
 *   - Copies the workspace markdown bundle (BOOTSTRAP, AGENTS, SOUL, USER,
 *     IDENTITY, TOOLS, HEARTBEAT, prompts/*) into `~/.openclaw/workspace/`.
 *
 * Anything the agent should *do at runtime* (greet the user, create their
 * profile, install cron jobs, send the welcome message, delete BOOTSTRAP.md)
 * stays in BOOTSTRAP.md — the installer does not impersonate the agent.
 *
 * Usage:
 *   bun install.ts <INDEX_API_KEY>
 *   INDEX_API_KEY=... bun install.ts
 */

import { existsSync, mkdirSync, copyFileSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";

const PROTOCOL_MCP_URL = "https://protocol.index.network/mcp";
const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const SOURCE_WORKSPACE = join(SCRIPT_DIR, "workspace");
const TARGET_WORKSPACE = join(homedir(), ".openclaw", "workspace");

function readApiKey(): string {
  const fromArg = process.argv[2]?.trim();
  const fromEnv = process.env.INDEX_API_KEY?.trim();
  const key = fromArg || fromEnv;
  if (!key) {
    console.error("error: INDEX_API_KEY required");
    console.error("usage: bun install.ts <INDEX_API_KEY>");
    console.error("       INDEX_API_KEY=<key> bun install.ts");
    process.exit(1);
  }
  return key;
}

function ensureOpenclawAvailable(): void {
  try {
    execSync("openclaw --version", { stdio: "ignore" });
  } catch {
    console.error("error: `openclaw` CLI not found on PATH");
    console.error("       install OpenClaw first: https://openclaw.dev");
    process.exit(1);
  }
}

function patchOpenclawConfig(apiKey: string): void {
  const mcpEntry = JSON.stringify({
    url: PROTOCOL_MCP_URL,
    transport: "streamable-http",
    headers: { "x-api-key": apiKey },
  });

  console.log("→ writing mcp.servers.index");
  execSync(`openclaw config set mcp.servers.index '${mcpEntry}' --strict-json`, {
    stdio: ["ignore", "ignore", "inherit"],
  });

  console.log("→ disabling telegram progress-draft tidepooling");
  execSync("openclaw config set channels.telegram.streaming.mode off", {
    stdio: ["ignore", "ignore", "inherit"],
  });

  // One-shot cleanup so users who installed the pre-0.22.0 OpenClaw-plugin do
  // not end up with two MCP entries pointing at the same server.
  try {
    execSync("openclaw config unset mcp.servers.index-network", { stdio: "ignore" });
    console.log("→ migrated legacy mcp.servers.index-network");
  } catch {
    // Entry didn't exist — fine.
  }
}

function copyWorkspaceFiles(): void {
  if (!existsSync(SOURCE_WORKSPACE)) {
    console.error(`error: bundled workspace missing at ${SOURCE_WORKSPACE}`);
    process.exit(1);
  }

  if (!existsSync(TARGET_WORKSPACE)) {
    mkdirSync(TARGET_WORKSPACE, { recursive: true });
  }

  let copied = 0;
  for (const entry of readdirSync(SOURCE_WORKSPACE)) {
    const sourcePath = join(SOURCE_WORKSPACE, entry);
    const targetPath = join(TARGET_WORKSPACE, entry);
    const stat = statSync(sourcePath);

    if (stat.isDirectory()) {
      if (!existsSync(targetPath)) mkdirSync(targetPath, { recursive: true });
      for (const inner of readdirSync(sourcePath)) {
        if (!inner.endsWith(".md")) continue;
        copyFileSync(join(sourcePath, inner), join(targetPath, inner));
        copied++;
      }
    } else if (entry.endsWith(".md")) {
      copyFileSync(sourcePath, targetPath);
      copied++;
    }
  }

  console.log(`→ staged ${copied} workspace files into ${TARGET_WORKSPACE}`);
}

function main(): void {
  const apiKey = readApiKey();
  ensureOpenclawAvailable();

  console.log("Edge Claw installer");
  console.log("===================");
  console.log("");

  patchOpenclawConfig(apiKey);
  copyWorkspaceFiles();

  console.log("");
  console.log("✓ installed");
  console.log("");
  console.log("next:");
  console.log("  1. restart the gateway:  openclaw gateway restart");
  console.log("  2. send any message in your chat — Edge Claw will run BOOTSTRAP.md");
}

main();
