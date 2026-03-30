#!/usr/bin/env node

/**
 * Thin bin shim for @indexnetwork/cli.
 *
 * Resolves and executes the platform-specific precompiled binary from
 * the corresponding optional dependency package. If no platform binary
 * is available, falls back to running the bundled JS via Node or Bun.
 *
 * This file must remain plain JavaScript (no TypeScript, no bundling)
 * so it works immediately after npm install without a build step.
 */

"use strict";

const { execFileSync } = require("child_process");
const { existsSync } = require("fs");
const path = require("path");

/**
 * Construct the npm package name for the current platform binary.
 *
 * @param {string} os - The operating system (e.g. "linux", "darwin").
 * @param {string} arch - The CPU architecture (e.g. "x64", "arm64").
 * @returns {string} The scoped package name.
 */
function platformPackageName(os, arch) {
  return `@indexnetwork/cli-${os}-${arch}`;
}

/**
 * Attempt to resolve the path to the platform binary.
 *
 * @returns {string|null} Absolute path to the binary, or null if not found.
 */
function resolvePlatformBinary() {
  const pkg = platformPackageName(process.platform, process.arch);

  try {
    // require.resolve finds the package in node_modules, even when hoisted
    const pkgJson = require.resolve(`${pkg}/package.json`);
    const pkgDir = path.dirname(pkgJson);
    const binPath = path.join(pkgDir, "bin", "index");

    if (existsSync(binPath)) {
      return binPath;
    }
  } catch {
    // Package not installed — expected on unsupported platforms
  }

  return null;
}

/**
 * Resolve the bundled JS fallback path.
 *
 * @returns {string|null} Absolute path to dist/index.js, or null if not found.
 */
function resolveFallbackJs() {
  const fallback = path.join(__dirname, "..", "dist", "index.js");
  if (existsSync(fallback)) {
    return fallback;
  }
  return null;
}

// ── Main ──────────────────────────────────────────────────────────────

const args = process.argv.slice(2);

// Strategy 1: platform-specific precompiled binary
const binary = resolvePlatformBinary();
if (binary) {
  try {
    execFileSync(binary, args, { stdio: "inherit" });
  } catch (err) {
    process.exitCode = err.status || 1;
  }
  process.exit();
}

// Strategy 2: bundled JS fallback via bun or node
const fallbackJs = resolveFallbackJs();
if (fallbackJs) {
  // Prefer bun if available, otherwise node
  const runtime = (() => {
    try {
      execFileSync("bun", ["--version"], { stdio: "ignore" });
      return "bun";
    } catch {
      return process.execPath; // node
    }
  })();

  try {
    execFileSync(runtime, [fallbackJs, ...args], { stdio: "inherit" });
  } catch (err) {
    process.exitCode = err.status || 1;
  }
  process.exit();
}

// No binary, no fallback — report error
console.error(
  `@indexnetwork/cli: No precompiled binary found for ${process.platform}-${process.arch},\n` +
  `and no bundled JS fallback available at dist/index.js.\n\n` +
  `Try reinstalling: npm install -g @indexnetwork/cli`
);
process.exit(1);
