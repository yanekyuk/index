#!/usr/bin/env bun
/**
 * Materializes skill templates by injecting shared partials.
 *
 * Sources:
 *   packages/protocol/skills/openclaw/SKILL.md.template
 *   packages/protocol/skills/openclaw/index-orchestrator.template.md
 *   packages/protocol/skills/claude-plugin/index-orchestrator.template.md
 *   packages/protocol/skills/claude-plugin/index-negotiator.template.md
 *
 * Destinations:
 *   - skills/index-network/SKILL.md                                (repo-root workspace dev copy, gitignored)
 *   - packages/openclaw-plugin/skills/index-network/SKILL.md       (plugin payload, committed for subtree push)
 *   - packages/openclaw-plugin/skills/index-orchestrator/SKILL.md  (plugin payload, committed for subtree push)
 *   - packages/claude-plugin/skills/index-orchestrator/SKILL.md
 *   - packages/claude-plugin/skills/index-negotiator/SKILL.md
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

const REPO_ROOT = resolve(import.meta.dir, '..');
const TEMPLATE_PATH = join(
  REPO_ROOT,
  'packages/protocol/skills/openclaw/SKILL.md.template',
);
const CORE_GUIDANCE_PATH = join(
  REPO_ROOT,
  'packages/protocol/skills/core-guidance.partial.md',
);
const ORCHESTRATOR_TEMPLATE_PATH = join(
  REPO_ROOT,
  'packages/protocol/skills/claude-plugin/index-orchestrator.template.md',
);
const NEGOTIATOR_TEMPLATE_PATH = join(
  REPO_ROOT,
  'packages/protocol/skills/claude-plugin/index-negotiator.template.md',
);
const OPENCLAW_ORCHESTRATOR_TEMPLATE_PATH = join(
  REPO_ROOT,
  'packages/protocol/skills/openclaw/index-orchestrator.template.md',
);

export function resolveOutputPaths(repoRoot = REPO_ROOT): string[] {
  return [
    join(repoRoot, 'skills/index-network/SKILL.md'),
    join(repoRoot, 'packages/openclaw-plugin/skills/index-network/SKILL.md'),
  ];
}

export function resolveOpenclawPluginOutputs(repoRoot = REPO_ROOT): {
  orchestrator: string[];
} {
  return {
    orchestrator: [join(repoRoot, 'packages/openclaw-plugin/skills/index-orchestrator/SKILL.md')],
  };
}

export function resolveClaudePluginOutputs(repoRoot = REPO_ROOT): {
  orchestrator: string[];
  negotiator: string[];
} {
  return {
    orchestrator: [join(repoRoot, 'packages/claude-plugin/skills/index-orchestrator/SKILL.md')],
    negotiator: [join(repoRoot, 'packages/claude-plugin/skills/index-negotiator/SKILL.md')],
  };
}

export function injectPartials(template: string, partials: Record<string, string>): string {
  let output = template;
  for (const [key, value] of Object.entries(partials)) {
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
  templatePath: string,
  outputPaths: string[],
  partials: Record<string, string> = {},
): void {
  const template = readFileSync(templatePath, 'utf8');
  const content = injectPartials(template, partials);
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
  const coreGuidance = readFileSync(CORE_GUIDANCE_PATH, 'utf8');
  const partials = { CORE_GUIDANCE: coreGuidance };

  build(TEMPLATE_PATH, resolveOutputPaths(), partials);

  const openclawOutputs = resolveOpenclawPluginOutputs();
  build(OPENCLAW_ORCHESTRATOR_TEMPLATE_PATH, openclawOutputs.orchestrator, partials);

  const claudeOutputs = resolveClaudePluginOutputs();
  build(ORCHESTRATOR_TEMPLATE_PATH, claudeOutputs.orchestrator, partials);
  build(NEGOTIATOR_TEMPLATE_PATH, claudeOutputs.negotiator, partials);
}
