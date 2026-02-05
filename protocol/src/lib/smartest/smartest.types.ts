/**
 * Smartest scenario and result types.
 * Domain: smartest (spec-driven, LLM-verified testing for agents and graphs).
 */

import type { z } from 'zod';

/**
 * Declarative generator reference: name + optional params (e.g. seed, prompt, responseSchema).
 */
export interface GeneratorDef {
  generate: string;
  seed?: number;
  /** Generator-specific params (e.g. prompt, maxTokens, hint, responseSchema). */
  params?: Record<string, unknown>;
  /**
   * Optional Zod schema for structured output. Pass at top level or inside params.
   * The built-in "text" generator uses this with withStructuredOutput(); custom generators may too.
   */
  responseSchema?: z.ZodType<unknown>;
  /** Alias for responseSchema. */
  schema?: z.ZodType<unknown>;
  [key: string]: unknown;
}

/**
 * Params passed to a generator function.
 * Use responseSchema (Zod schema) to get structured output from LLM generators.
 */
export interface GeneratorParams {
  seed?: number;
  params?: Record<string, unknown>;
  /**
   * Optional Zod schema for structured output. When set, the generator uses
   * withStructuredOutput(schema) and returns the parsed object instead of raw text.
   */
  responseSchema?: z.ZodType<unknown>;
  /** Alias for responseSchema. */
  schema?: z.ZodType<unknown>;
  [key: string]: unknown;
}

/**
 * A generator function: takes params and returns a value (or promise).
 */
export type GeneratorFn = (params: GeneratorParams) => Promise<unknown> | unknown;

/**
 * Registry of named generators for fixture generation.
 */
export type GeneratorRegistry = Record<string, GeneratorFn>;

/**
 * Fixture definition: inline value, async function, or declarative generator ref.
 */
export type FixtureDef =
  | unknown
  | (() => Promise<unknown>)
  | GeneratorDef;

/**
 * Resolved fixtures map (key -> value after running generators).
 */
export type ResolvedFixtures = Record<string, unknown>;

/**
 * SUT (system under test) configuration.
 */
export interface SmartestSut {
  /** 'agent' | 'graph' for documentation; runner does not branch on this. */
  type: 'agent' | 'graph';
  /** Creates the agent or compiled graph instance. */
  factory: () => unknown;
  /** Invokes the SUT with (instance, resolvedInput) and returns the output. */
  invoke: (instance: unknown, resolvedInput: unknown) => Promise<unknown>;
  /** Input to pass to invoke; may contain @fixtures.<key> refs. */
  input: unknown;
}

/**
 * Verification configuration.
 */
export interface SmartestVerification {
  /** Optional Zod schema to validate output shape before LLM verify. */
  schema?: z.ZodType<unknown>;
  /** Natural language criteria for the LLM judge. */
  criteria: string;
  /** Whether to run the LLM verifier (default true). */
  llmVerify?: boolean;
}

/**
 * Scenario definition: what to run and how to verify.
 */
export interface SmartestScenario {
  name: string;
  description: string;
  fixtures?: Record<string, FixtureDef>;
  sut: SmartestSut;
  verification: SmartestVerification;
}

/**
 * Result of the LLM verifier.
 */
export interface VerificationResult {
  pass: boolean;
  reasoning: string;
}

/**
 * Phase timings and summary attached to RunScenarioResult for tests to log.
 * Use this (and verification.reasoning) in test failure messages so bun test shows Smartest info.
 */
export interface RunScenarioReport {
  scenarioName: string;
  /** Phase name -> elapsed ms */
  phases: Record<string, number>;
  totalMs: number;
  /** Set when LLM verifier ran (model id). */
  verifierModel?: string;
}

/**
 * Result of runScenario().
 */
export interface RunScenarioResult {
  pass: boolean;
  output?: unknown;
  verification?: VerificationResult;
  /** Set when schema validation fails. */
  schemaError?: string;
  /** Timings and summary; use in test assertions so bun test output includes Smartest info. */
  report?: RunScenarioReport;
}

/**
 * Options for runScenario (e.g. custom generator registry).
 */
export interface RunScenarioOptions {
  /** Override or extend the default generator registry. */
  generators?: GeneratorRegistry;
}
