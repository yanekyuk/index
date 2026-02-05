/**
 * Test helper: assert runScenario result and surface Smartest info (reasoning, report)
 * through bun test failure output. Use instead of raw expect(result.pass).toBe(true)
 * so failures show verifier reasoning and phase timings in one place.
 */

import type { RunScenarioResult, RunScenarioReport } from './smartest.types';

function formatReport(report: RunScenarioReport): string {
  const lines = [
    `scenario: ${report.scenarioName}`,
    `total: ${report.totalMs}ms`,
    `phases: ${Object.entries(report.phases)
      .map(([k, v]) => `${k}=${v}ms`)
      .join(', ')}`,
  ];
  if (report.verifierModel) {
    lines.push(`verifier: ${report.verifierModel}`);
  }
  return lines.join(' | ');
}

/**
 * Asserts that the Smartest scenario passed. On failure, throws an Error whose message
 * includes the report (timings), schema error (if any), and verifier reasoning (if any),
 * so bun test displays a single, coherent failure block.
 *
 * @example
 * const result = await runScenario(defineScenario({ ... }));
 * expectSmartest(result);
 */
export function expectSmartest(result: RunScenarioResult): void {
  if (result.pass) {
    return;
  }
  const parts: string[] = [];
  if (result.report) {
    parts.push(formatReport(result.report));
  }
  if (result.schemaError) {
    parts.push(`Schema: ${result.schemaError}`);
  }
  if (result.verification?.reasoning) {
    parts.push(`Reasoning: ${result.verification.reasoning}`);
  }
  const message = parts.length ? parts.join('\n\n') : 'Smartest scenario failed.';
  throw new Error(message);
}
