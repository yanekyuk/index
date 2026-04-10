/**
 * Tests for scripts/build-skills.ts
 *
 * Verifies env resolution, token substitution, failure on unreplaced
 * tokens, and write-to-multiple-destinations behavior using temporary
 * directories so tests never touch the real output locations.
 */

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import {
  writeFileSync,
  mkdtempSync,
  rmSync,
  readFileSync,
  existsSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { resolveTargetEnv, substituteTokens, build, TOKENS } from '../build-skills.js';

describe('resolveTargetEnv', () => {
  test('defaults to main when no CLI flag or env var', () => {
    expect(resolveTargetEnv([], {})).toBe('main');
  });

  test('reads TARGET_ENV env var', () => {
    expect(resolveTargetEnv([], { TARGET_ENV: 'dev' })).toBe('dev');
  });

  test('reads TARGET_ENV=main explicitly', () => {
    expect(resolveTargetEnv([], { TARGET_ENV: 'main' })).toBe('main');
  });

  test('--env flag takes precedence over env var', () => {
    expect(resolveTargetEnv(['--env=main'], { TARGET_ENV: 'dev' })).toBe('main');
  });

  test('throws on invalid CLI flag value', () => {
    expect(() => resolveTargetEnv(['--env=staging'], {})).toThrow(/Invalid --env/);
  });

  test('throws on invalid env var value', () => {
    expect(() => resolveTargetEnv([], { TARGET_ENV: 'prod' })).toThrow(/Invalid TARGET_ENV/);
  });

  test('ignores unrelated argv entries', () => {
    expect(resolveTargetEnv(['--unrelated', '--env=dev', 'other'], {})).toBe('dev');
  });
});

describe('substituteTokens', () => {
  test('replaces all known tokens against the main token set', () => {
    const template =
      'name: {{MCP_NAME}}\nurl: {{MCP_URL}}\nfrontend: {{FRONTEND_URL}}';
    const result = substituteTokens(template, TOKENS.main);
    expect(result).toBe(
      'name: index-network\nurl: https://protocol.index.network/mcp\nfrontend: https://index.network',
    );
  });

  test('replaces all known tokens against the dev token set', () => {
    const template = '{{MCP_NAME}} / {{MCP_URL}} / {{FRONTEND_URL}}';
    const result = substituteTokens(template, TOKENS.dev);
    expect(result).toBe(
      'index-network-dev / https://dev.protocol.index.network/mcp / https://dev.index.network',
    );
  });

  test('replaces the same token multiple times', () => {
    const template = '{{MCP_NAME}} and {{MCP_NAME}} again';
    expect(substituteTokens(template, TOKENS.main)).toBe(
      'index-network and index-network again',
    );
  });

  test('throws on unreplaced token', () => {
    const template = 'hello {{UNKNOWN_TOKEN}}';
    expect(() => substituteTokens(template, TOKENS.main)).toThrow(
      /Unreplaced tokens.*UNKNOWN_TOKEN/,
    );
  });

  test('lists all distinct unreplaced tokens in the error message', () => {
    const template = '{{FOO}} and {{BAR}} and {{FOO}}';
    try {
      substituteTokens(template, TOKENS.main);
      throw new Error('expected substituteTokens to throw');
    } catch (err) {
      const message = (err as Error).message;
      expect(message).toContain('FOO');
      expect(message).toContain('BAR');
    }
  });

  test('detects unreplaced tokens with lowercase or mixed-case names', () => {
    const template = 'hello {{mcp_name}} and {{Mixed-Case}}';
    expect(() => substituteTokens(template, TOKENS.main)).toThrow(
      /Unreplaced tokens/,
    );
  });

  test('preserves non-token braces and brackets verbatim', () => {
    const template = 'No tokens here, plain text with {single} and [brackets].';
    expect(substituteTokens(template, TOKENS.main)).toBe(
      'No tokens here, plain text with {single} and [brackets].',
    );
  });
});

describe('build', () => {
  let tmpDir: string;
  let templatePath: string;
  let output1: string;
  let output2: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'build-skills-'));
    templatePath = join(tmpDir, 'template.md');
    output1 = join(tmpDir, 'out1/SKILL.md');
    output2 = join(tmpDir, 'out2/nested/SKILL.md');
    writeFileSync(templatePath, 'name: {{MCP_NAME}}\nurl: {{MCP_URL}}');
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test('writes to both output paths with main env', () => {
    build('main', templatePath, [output1, output2]);
    expect(existsSync(output1)).toBe(true);
    expect(existsSync(output2)).toBe(true);
    const expected = 'name: index-network\nurl: https://protocol.index.network/mcp';
    expect(readFileSync(output1, 'utf8')).toBe(expected);
    expect(readFileSync(output2, 'utf8')).toBe(expected);
  });

  test('writes dev-env content when target is dev', () => {
    build('dev', templatePath, [output1]);
    expect(readFileSync(output1, 'utf8')).toBe(
      'name: index-network-dev\nurl: https://dev.protocol.index.network/mcp',
    );
  });

  test('creates missing parent directories recursively', () => {
    const deep = join(tmpDir, 'a/b/c/d/SKILL.md');
    build('main', templatePath, [deep]);
    expect(existsSync(deep)).toBe(true);
  });

  test('overwrites existing files on repeated runs', () => {
    build('main', templatePath, [output1]);
    build('dev', templatePath, [output1]);
    expect(readFileSync(output1, 'utf8')).toContain('index-network-dev');
  });

  test('propagates substitution errors', () => {
    writeFileSync(templatePath, 'bad {{UNKNOWN}}');
    expect(() => build('main', templatePath, [output1])).toThrow(/Unreplaced tokens/);
  });
});
