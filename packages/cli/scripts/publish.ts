#!/usr/bin/env bun
/**
 * Publish script for the Index CLI npm packages.
 *
 * Orchestrates the full release flow:
 *   1. Runs the build script to cross-compile all targets.
 *   2. Publishes each platform-specific package (@indexnetwork/cli-{os}-{arch}).
 *   3. Publishes the main package (@indexnetwork/cli).
 *
 * Platform packages must be published first so they exist in the registry
 * when users install the main package.
 *
 * Usage:
 *   bun scripts/publish.ts              # Publish all packages
 *   bun scripts/publish.ts --dry-run    # Preview without publishing
 *   bun scripts/publish.ts --skip-build # Skip the build step (use existing artifacts)
 */

import { $ } from "bun";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";

const CLI_ROOT = resolve(import.meta.dir, "..");

/** Platform package directories in publish order. */
const PLATFORM_DIRS = [
  "linux-x64",
  "linux-arm64",
  "darwin-x64",
  "darwin-arm64",
];

const dryRun = process.argv.includes("--dry-run");
const skipBuild = process.argv.includes("--skip-build");

/**
 * Read the version from the main package.json.
 *
 * @returns The current CLI version string.
 */
async function readVersion(): Promise<string> {
  const pkgPath = join(CLI_ROOT, "package.json");
  const pkg = JSON.parse(await readFile(pkgPath, "utf-8"));
  return pkg.version;
}

/**
 * Publish a single package directory to npm.
 *
 * @param dir - Absolute path to the package directory.
 * @param name - Display name for logging.
 */
async function publishPackage(dir: string, name: string): Promise<void> {
  console.log(`[publish] ${dryRun ? "(dry-run) " : ""}Publishing ${name}...`);

  try {
    if (dryRun) {
      await $`npm publish --access public --dry-run`.cwd(dir).quiet();
    } else {
      await $`npm publish --access public`.cwd(dir).quiet();
    }
    console.log(`[publish] ${name} published successfully`);
  } catch (err) {
    console.error(`[publish] Failed to publish ${name}`);
    throw err;
  }
}

// ── Main ──────────────────────────────────────────────────────────────

const version = await readVersion();

console.log(`[publish] Index CLI v${version}`);
console.log(`[publish] Mode: ${dryRun ? "dry-run" : "live"}`);
console.log();

// Step 1: Build (unless --skip-build)
if (!skipBuild) {
  console.log("[publish] Running build...");
  await $`bun ${join(CLI_ROOT, "scripts", "build.ts")}`;
  console.log();
}

// Step 2: Publish platform packages first
console.log("[publish] Publishing platform packages...");
for (const dir of PLATFORM_DIRS) {
  const pkgDir = join(CLI_ROOT, "npm", dir);
  const name = `@indexnetwork/cli-${dir}`;
  await publishPackage(pkgDir, name);
}
console.log();

// Step 3: Publish main package
console.log("[publish] Publishing main package...");
await publishPackage(CLI_ROOT, "@indexnetwork/cli");

console.log();
console.log(`[publish] Done! All packages ${dryRun ? "validated" : "published"} for v${version}.`);
