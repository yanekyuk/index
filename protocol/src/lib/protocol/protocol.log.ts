/**
 * Protocol-layer logging: call-scoped inputs, outputs, and context for debugging.
 * Use protocolLogger('ComponentName') for the logger, then wrap calls with
 * withCallLogging or use logCallStart/end for manual control. All protocol code
 * should log inputs at call start and outputs (or summary) + duration at end.
 */

import { log, sanitizeForLog } from "../log";
import type { LoggerWithSource } from "../log";

export type { LoggerWithSource };

/** Create a protocol logger for a given source (e.g. "ChatTools", "DiscoverNodes"). */
export function protocolLogger(source: string): LoggerWithSource {
  return log.protocol.from(source);
}

export interface CallLogOptions {
  /** Log full output on success (default: true). Set false for very large payloads. */
  logOutput?: boolean;
  /** Extra context to include in both start and end (e.g. userId, indexId). */
  context?: Record<string, unknown>;
}

/**
 * Wraps an async call with consistent logging: inputs at start, outputs + duration at end,
 * error + duration on failure. All payloads are sanitized (embeddings redacted).
 */
export async function withCallLogging<T>(
  logger: LoggerWithSource,
  callName: string,
  inputs: Record<string, unknown>,
  fn: () => Promise<T>,
  options: CallLogOptions = {}
): Promise<T> {
  const { logOutput = true, context = {} } = options;
  const start = Date.now();
  const sanitizedInputs = sanitizeForLog(inputs) as Record<string, unknown>;
  logger.info(`[Call] ${callName} start`, { inputs: sanitizedInputs, ...context });

  try {
    const result = await fn();
    const durationMs = Date.now() - start;
    const outMeta: Record<string, unknown> = {
      durationMs,
      ...context,
    };
    if (logOutput) {
      outMeta.output = sanitizeForLog(result);
    }
    logger.info(`[Call] ${callName} end`, outMeta);
    return result;
  } catch (err) {
    const durationMs = Date.now() - start;
    logger.error(`[Call] ${callName} failed`, {
      error: err,
      durationMs,
      ...context,
    });
    throw err;
  }
}

/**
 * Log the start of a call (inputs + optional context). Returns an end function to call
 * with output on success, or call logCallEndError on failure. Use when you need manual
 * control (e.g. different success paths or streaming).
 */
export function logCallStart(
  logger: LoggerWithSource,
  callName: string,
  inputs: Record<string, unknown>,
  context?: Record<string, unknown>
): { end: (output: unknown) => void; endError: (error: unknown) => void } {
  const start = Date.now();
  const sanitizedInputs = sanitizeForLog(inputs) as Record<string, unknown>;
  logger.info(`[Call] ${callName} start`, { inputs: sanitizedInputs, ...context });

  return {
    end(output: unknown) {
      const durationMs = Date.now() - start;
      logger.info(`[Call] ${callName} end`, {
        output: sanitizeForLog(output),
        durationMs,
        ...context,
      });
    },
    endError(error: unknown) {
      const durationMs = Date.now() - start;
      logger.error(`[Call] ${callName} failed`, {
        error,
        durationMs,
        ...context,
      });
    },
  };
}
