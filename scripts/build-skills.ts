#!/usr/bin/env bun
/**
 * Materializes the OpenClaw bootstrap skill template into two destinations.
 *
 * Source:
 *   packages/protocol/skills/openclaw/SKILL.md.template
 *
 * Destinations:
 *   - skills/openclaw/SKILL.md                             (repo-root workspace dev copy, gitignored)
 *   - packages/openclaw-plugin/skills/openclaw/SKILL.md    (plugin payload, committed for subtree push)
 *
 * Target environment (one of "main" | "dev") is resolved in this order:
 *   1. --env=<main|dev> CLI flag
 *   2. TARGET_ENV environment variable
 *   3. "main" by default
 *
 * The build fails loudly if any {{TOKEN}} remains unreplaced in the output.
 */

import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  existsSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';

export type TargetEnv = 'main' | 'dev';

export interface TokenSet {
  MCP_NAME: string;
  MCP_URL: string;
  FRONTEND_URL: string;
}

export const TOKENS: Record<TargetEnv, TokenSet> = {
  main: {
    MCP_NAME: 'index-network',
    MCP_URL: 'https://protocol.index.network/mcp',
    FRONTEND_URL: 'https://index.network',
  },
  dev: {
    MCP_NAME: 'index-network-dev',
    MCP_URL: 'https://dev.protocol.index.network/mcp',
    FRONTEND_URL: 'https://dev.index.network',
  },
};

const REPO_ROOT = resolve(import.meta.dir, '..');
const TEMPLATE_PATH = join(
  REPO_ROOT,
  'packages/protocol/skills/openclaw/SKILL.md.template',
);
const OUTPUT_PATHS = [
  join(REPO_ROOT, 'skills/openclaw/SKILL.md'),
  join(REPO_ROOT, 'packages/openclaw-plugin/skills/openclaw/SKILL.md'),
];

function isTargetEnv(value: string): value is TargetEnv {
  return value === 'main' || value === 'dev';
}

export function resolveTargetEnv(
  argv: string[],
  env: Record<string, string | undefined>,
): TargetEnv {
  const flag = argv.find((a) => a.startsWith('--env='));
  if (flag) {
    const value = flag.slice('--env='.length);
    if (!isTargetEnv(value)) {
      throw new Error(`Invalid --env value "${value}". Must be "main" or "dev".`);
    }
    return value;
  }
  const envVar = env.TARGET_ENV;
  if (envVar !== undefined && envVar !== '') {
    if (!isTargetEnv(envVar)) {
      throw new Error(`Invalid TARGET_ENV "${envVar}". Must be "main" or "dev".`);
    }
    return envVar;
  }
  return 'main';
}

export function substituteTokens(template: string, tokens: TokenSet): string {
  let output = template;
  for (const [key, value] of Object.entries(tokens)) {
    output = output.replaceAll(`{{${key}}}`, value);
  }
  const leftover = output.match(/\{\{[^{}]+\}\}/g);
  if (leftover) {
    const distinct = [...new Set(leftover)].join(', ');
    throw new Error(`Unreplaced tokens in template: ${distinct}`);
  }
  return output;
}

export function build(
  targetEnv: TargetEnv,
  templatePath: string,
  outputPaths: string[],
): void {
  const template = readFileSync(templatePath, 'utf8');
  const content = substituteTokens(template, TOKENS[targetEnv]);
  for (const outputPath of outputPaths) {
    const dir = dirname(outputPath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    writeFileSync(outputPath, content, 'utf8');
    console.log(`[build-skills] wrote ${outputPath}`);
  }
}

if (import.meta.main) {
  const targetEnv = resolveTargetEnv(process.argv.slice(2), process.env);
  console.log(`[build-skills] target env: ${targetEnv}`);
  build(targetEnv, TEMPLATE_PATH, OUTPUT_PATHS);
}
