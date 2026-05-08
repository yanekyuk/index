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
 *   - Bootstraps the OpenClaw gateway hooks subsystem (hooks.enabled,
 *     hooks.token, hooks.allowRequestSessionKey, hooks.allowedSessionKeyPrefixes)
 *     so the installer can dispatch the welcome message via POST /hooks/agent
 *     without waiting for the user to chat first.
 *   - Copies the workspace markdown bundle (BOOTSTRAP, AGENTS, SOUL, USER,
 *     IDENTITY, TOOLS, HEARTBEAT, COMMUNITY, prompts/*) into
 *     `~/.openclaw/workspace/`.
 *   - Installs three cron jobs: the daily morning digest (08:00), and two
 *     ambient discovery passes (14:00 and 20:00 host-local). Each pass is
 *     selective — max 3 direct + 3 introducer opportunities per dispatch,
 *     gated on the same quality bar.
 *   - Restarts the gateway so all config changes and cron jobs take effect.
 *   - Dispatches the welcome ambient pass via the gateway hooks endpoint.
 *     The welcome.md prompt itself checks `onboardingComplete` server-side:
 *     if the user has not yet onboarded, the dispatch no-ops (the welcome
 *     will be delivered by BOOTSTRAP.md once the user finishes the ritual);
 *     if the user is already onboarded, the welcome lands in the
 *     last-active chat session.
 *
 * Anything the agent should *do at runtime* (greet the user, create their
 * profile, send the welcome message body) stays in BOOTSTRAP.md /
 * prompts/welcome.md — the installer does not impersonate the agent.
 *
 * Usage:
 *   bun install.ts <INDEX_API_KEY>
 *   INDEX_API_KEY=... bun install.ts
 */

import { existsSync, mkdirSync, copyFileSync, readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";
import { randomBytes } from "node:crypto";

const PROTOCOL_MCP_URL = "https://protocol.index.network/mcp";
const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const SOURCE_WORKSPACE = join(SCRIPT_DIR, "workspace");
const TARGET_WORKSPACE = join(homedir(), ".openclaw", "workspace");
const OPENCLAW_CONFIG = join(homedir(), ".openclaw", "openclaw.json");
const WELCOME_NAME = "Edge Claw — welcome";

interface OpenclawConfig {
  gateway?: { port?: number };
  hooks?: {
    enabled?: boolean;
    token?: string;
    path?: string;
    allowRequestSessionKey?: boolean;
    allowedSessionKeyPrefixes?: string[];
  };
}

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

function readOpenclawConfig(): OpenclawConfig {
  if (!existsSync(OPENCLAW_CONFIG)) return {};
  try {
    return JSON.parse(readFileSync(OPENCLAW_CONFIG, "utf8")) as OpenclawConfig;
  } catch {
    return {};
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

/**
 * Returns the (possibly newly-generated) hooks bearer token. Idempotent:
 * if `hooks.token` is already set in openclaw.json, reuse it so we don't
 * break a co-installed openclaw-plugin that also relies on it.
 */
function ensureHooksConfig(): string {
  const config = readOpenclawConfig();
  const existingToken = config.hooks?.token;
  const token = existingToken && existingToken.length > 0
    ? existingToken
    : randomBytes(32).toString("hex");

  if (!existingToken) {
    console.log("→ generating hooks.token");
    execSync(`openclaw config set hooks.token '${token}'`, {
      stdio: ["ignore", "ignore", "inherit"],
    });
  }

  if (config.hooks?.enabled !== true) {
    console.log("→ enabling hooks");
    execSync("openclaw config set hooks.enabled true", { stdio: ["ignore", "ignore", "inherit"] });
  }
  if (config.hooks?.allowRequestSessionKey !== true) {
    execSync("openclaw config set hooks.allowRequestSessionKey true", {
      stdio: ["ignore", "ignore", "inherit"],
    });
  }

  const prefixes = new Set(config.hooks?.allowedSessionKeyPrefixes ?? []);
  if (!prefixes.has("agent:main:")) {
    prefixes.add("agent:main:");
    const prefixesJson = JSON.stringify([...prefixes]);
    execSync(`openclaw config set hooks.allowedSessionKeyPrefixes '${prefixesJson}' --strict-json`, {
      stdio: ["ignore", "ignore", "inherit"],
    });
  }

  return token;
}

function installCronJobs(): void {
  const npmBin = `${process.env.HOME}/.npm/bin`;
  const localBin = `${process.env.HOME}/.local/bin`;
  const env = { ...process.env, PATH: `${npmBin}:${localBin}:${process.env.PATH}` };
  const workspaceDir = join(homedir(), ".openclaw", "workspace");

  // Remove existing Edge Claw cron jobs before re-adding to stay idempotent.
  try {
    const raw = execSync("openclaw cron list --json", { encoding: "utf8", env });
    const parsed = JSON.parse(raw) as { jobs?: Array<{ id: string; name: string }> };
    for (const job of parsed.jobs ?? []) {
      if (job.name.startsWith("Edge Claw")) {
        execSync(`openclaw cron remove ${job.id}`, { stdio: "ignore", env });
      }
    }
  } catch {
    // Gateway may be mid-restart; proceed and let cron add handle any conflicts.
  }

  console.log("→ installing cron jobs");

  execSync(
    `openclaw cron add \
      --name "Edge Claw — daily digest" \
      --cron "0 8 * * *" \
      --session isolated \
      --light-context \
      --announce \
      --channel last \
      --message "$(cat ${workspaceDir}/prompts/digest.md)"`,
    { stdio: ["ignore", "ignore", "inherit"], env, shell: "/bin/sh" },
  );

  execSync(
    `openclaw cron add \
      --name "Edge Claw — ambient discovery (afternoon)" \
      --cron "0 14 * * *" \
      --session isolated \
      --light-context \
      --announce \
      --channel last \
      --message "$(cat ${workspaceDir}/prompts/ambient.md)"`,
    { stdio: ["ignore", "ignore", "inherit"], env, shell: "/bin/sh" },
  );

  execSync(
    `openclaw cron add \
      --name "Edge Claw — ambient discovery (evening)" \
      --cron "0 20 * * *" \
      --session isolated \
      --light-context \
      --announce \
      --channel last \
      --message "$(cat ${workspaceDir}/prompts/ambient.md)"`,
    { stdio: ["ignore", "ignore", "inherit"], env, shell: "/bin/sh" },
  );
}

function restartGateway(): void {
  console.log("→ restarting gateway");
  try {
    execSync("openclaw gateway restart", { stdio: ["ignore", "ignore", "inherit"] });
  } catch {
    console.warn("  warning: could not restart gateway — run manually: openclaw gateway restart");
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

/**
 * Dispatch the welcome ambient pass via the gateway hooks endpoint. The
 * welcome.md prompt itself checks `onboardingComplete` and the in-memory
 * dedup flag — this dispatch is safe to run on every install:
 *   - first install / not-onboarded user → prompt returns NO_REPLY
 *     (BOOTSTRAP.md will deliver the welcome at the end of the ritual)
 *   - already-onboarded user → welcome lands in the last-active chat session
 *   - re-install of an already-welcomed user → prompt sees the dedup flag
 *     and returns NO_REPLY
 *
 * After waiting briefly for the gateway to come back up post-restart, we
 * post the welcome prompt to /hooks/agent. Failures are non-fatal — the
 * agent will deliver the welcome via BOOTSTRAP.md on the next chat turn.
 */
async function dispatchWelcome(hooksToken: string): Promise<void> {
  const config = readOpenclawConfig();
  const port = config.gateway?.port;
  if (!port) {
    console.warn("  warning: gateway.port unknown — skipping welcome dispatch");
    return;
  }

  const hooksPath = (config.hooks?.path ?? "/hooks").replace(/\/+$/, "");
  const url = `http://127.0.0.1:${port}${hooksPath}/agent`;

  const welcomeMd = readFileSync(join(TARGET_WORKSPACE, "prompts", "welcome.md"), "utf8");

  // Wait up to 10s for the gateway to be reachable post-restart.
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    try {
      const probe = await fetch(`http://127.0.0.1:${port}/healthz`, {
        signal: AbortSignal.timeout(500),
      });
      if (probe.ok) break;
    } catch {
      // not yet
    }
    await new Promise((r) => setTimeout(r, 250));
  }

  console.log("→ dispatching welcome");
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${hooksToken}`,
        "idempotency-key": `edge-claw:welcome:${new Date().toISOString().slice(0, 10)}`,
      },
      body: JSON.stringify({
        message: welcomeMd,
        name: WELCOME_NAME,
        wakeMode: "now",
        deliver: true,
        channel: "last",
      }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      console.warn(`  warning: welcome dispatch returned ${res.status}: ${detail.slice(0, 200)}`);
    }
  } catch (err) {
    console.warn(
      `  warning: welcome dispatch failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

async function main(): Promise<void> {
  const apiKey = readApiKey();
  ensureOpenclawAvailable();

  console.log("Edge Claw installer");
  console.log("===================");
  console.log("");

  patchOpenclawConfig(apiKey);
  const hooksToken = ensureHooksConfig();
  copyWorkspaceFiles();
  installCronJobs();
  restartGateway();
  await dispatchWelcome(hooksToken);

  console.log("");
  console.log("✓ installed");
  console.log("");
  console.log("next:");
  console.log("  - if you've onboarded before, the welcome should land in your chat shortly");
  console.log("  - otherwise, send any message — Edge Claw will run BOOTSTRAP.md and welcome you at the end");
}

main();
