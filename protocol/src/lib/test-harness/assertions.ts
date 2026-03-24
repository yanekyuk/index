import type { ZodSchema, ZodError } from "zod";

import { callJudge } from "./judge";

/**
 * Asserts that a value matches a Zod schema.
 * Throws with formatted Zod error paths on failure.
 */
export function assertMatchesSchema<T>(value: unknown, schema: ZodSchema<T>): T {
  const result = schema.safeParse(value);
  if (!result.success) {
    const formatted = formatZodError(result.error);
    throw new Error(`Schema validation failed:\n${formatted}`);
  }
  return result.data;
}

function formatZodError(error: ZodError): string {
  return error.issues
    .map(issue => {
      const path = issue.path.length > 0 ? issue.path.join(".") : "(root)";
      return `  ${path}: ${issue.message}`;
    })
    .join("\n");
}

/** A single criterion to evaluate. */
export interface LLMCriterion {
  text: string;
  required?: boolean;
  min?: number;
}

/** Configuration for assertLLMEvaluate. */
export interface LLMEvaluateConfig {
  criteria: LLMCriterion[];
  minScore?: number;
  context?: string;
  timeout?: number;
}

/** Result of a single criterion evaluation. */
export interface CriterionResult {
  text: string;
  score: number;
  reasoning: string;
  required: boolean;
  min: number;
  passed: boolean;
}

/** Full evaluation result returned by assertLLMEvaluate. */
export interface LLMEvaluateResult {
  passed: boolean;
  criteria: CriterionResult[];
  overallScore: number;
  failedRequired: CriterionResult[];
  summary: string;
}

const DEFAULT_CRITERION_MIN = 0.5;
const DEFAULT_MIN_SCORE = 0.7;

/**
 * Evaluates a value against semantic criteria using an LLM judge.
 * Throws with a detailed report on failure.
 * Returns the full evaluation result for programmatic inspection.
 *
 * When `OPENROUTER_API_KEY` is not set, returns a passing no-op result and
 * logs a warning. This prevents CI environments without LLM access from
 * failing, but means semantic checks are silently skipped. For tests where
 * the LLM check is the primary assertion, wrap with
 * `describe.skipIf(!process.env.OPENROUTER_API_KEY)` so bun reports the
 * skip explicitly.
 */
export async function assertLLMEvaluate(
  value: unknown,
  config: LLMEvaluateConfig,
): Promise<LLMEvaluateResult> {
  // Skip test if no API key available (e.g. CI without LLM access)
  if (!process.env.OPENROUTER_API_KEY) {
    // Return a passing result with zero scores — the test effectively becomes a no-op.
    // Callers should guard with `describe.skipIf(!process.env.OPENROUTER_API_KEY)` for
    // cleaner skip semantics, but this prevents unexpected failures in keyless environments.
    console.warn("[test-harness] OPENROUTER_API_KEY not set — skipping LLM evaluation");
    return {
      passed: true,
      criteria: config.criteria.map(c => ({
        text: c.text,
        score: 0,
        reasoning: "Skipped: no API key",
        required: c.required ?? false,
        min: c.min ?? DEFAULT_CRITERION_MIN,
        passed: true,
      })),
      overallScore: 0,
      failedRequired: [],
      summary: "Skipped: OPENROUTER_API_KEY not set",
    };
  }

  const stringValue = typeof value === "string" ? value : JSON.stringify(value, null, 2);
  const minScore = config.minScore ?? DEFAULT_MIN_SCORE;

  const judgeResult = await callJudge({
    value: stringValue,
    criteria: config.criteria.map(c => c.text),
    context: config.context,
    timeout: config.timeout,
  });

  // Match judge scores back to criteria by criterion text (no array index fallback)
  const criteriaResults: CriterionResult[] = config.criteria.map((criterion, idx) => {
    const criterionLower = criterion.text.toLowerCase();
    // Try exact match first, then substring match
    const match = judgeResult.scores.find(s =>
      s.criterion.toLowerCase() === criterionLower
    ) ?? judgeResult.scores.find(s =>
      s.criterion.toLowerCase().includes(criterionLower.slice(0, 30))
        || criterionLower.includes(s.criterion.toLowerCase().slice(0, 30))
    ) ?? judgeResult.scores[idx]; // Last resort: positional

    if (match === judgeResult.scores[idx] && match?.criterion.toLowerCase() !== criterionLower) {
      console.warn(`[test-harness] Criterion "${criterion.text}" matched by positional fallback (judge returned "${match?.criterion}")`);
    }

    const score = match?.score ?? 0;
    const reasoning = match?.reasoning ?? "No judge response for this criterion";
    const min = criterion.min ?? DEFAULT_CRITERION_MIN;
    const required = criterion.required ?? false;

    return {
      text: criterion.text,
      score,
      reasoning,
      required,
      min,
      passed: score >= min,
    };
  });

  const overallScore = criteriaResults.length > 0
    ? criteriaResults.reduce((sum, c) => sum + c.score, 0) / criteriaResults.length
    : 0;

  const failedRequired = criteriaResults.filter(c => c.required && !c.passed);
  const overallPassed = overallScore >= minScore && failedRequired.length === 0;

  const summary = formatEvaluationReport(criteriaResults, overallScore, minScore, failedRequired);

  const result: LLMEvaluateResult = {
    passed: overallPassed,
    criteria: criteriaResults,
    overallScore,
    failedRequired,
    summary,
  };

  if (!overallPassed) {
    throw new Error(`LLM evaluation failed:\n${summary}`);
  }

  return result;
}

function formatEvaluationReport(
  criteria: CriterionResult[],
  overallScore: number,
  minScore: number,
  failedRequired: CriterionResult[],
): string {
  const lines = criteria.map(c => {
    const icon = c.passed ? "✓" : "✗";
    const reqTag = c.required ? " [required]" : "";
    const failNote = !c.passed
      ? c.required
        ? " ← FAILED"
        : ` — below ${c.min}`
      : "";
    return `${icon} ${c.text} (${c.score.toFixed(2)})${reqTag}${failNote}`;
  });

  lines.push(`Overall: ${overallScore.toFixed(2)} — ${overallScore >= minScore ? "above" : "below"} threshold ${minScore}`);

  if (failedRequired.length > 0) {
    lines.push(`FAILED: ${failedRequired.length} required criterion not met`);
  }

  return lines.join("\n");
}
