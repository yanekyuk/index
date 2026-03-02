import { log } from '../../log';

import { createMiddleware } from "../langchain";

const logger = log.lib.from('retry');

export interface RetryOptions {
    maxRetries?: number;
    timeoutMs?: number;
    delayMs?: number;
}

/**
 * Creates a middleware that retries the model call on failure.
 */
export function createRetryTool(options: RetryOptions = {}) {
    const { maxRetries = 3, timeoutMs = 30000, delayMs = 1000 } = options;

    return createMiddleware({
        name: "RetryMiddleware",
        wrapModelCall: async (request, next) => {
            let lastError: any;

            for (let attempt = 0; attempt <= maxRetries; attempt++) {
                try {
                    // Implement timeout Promise
                    const timeoutPromise = new Promise((_, reject) =>
                        setTimeout(() => reject(new Error(`Timeout after ${timeoutMs}ms`)), timeoutMs)
                    );

                    // Race between next() and timeout
                    // Note: This doesn't cancel the underlying request but prevents waiting forever.
                    const result = await Promise.race([
                        next(request),
                        timeoutPromise
                    ]);

                    return result;
                } catch (err) {
                    lastError = err;
                    const message = err instanceof Error ? err.message : String(err);
                    logger.warn('LLM retry attempt failed', { attempt: attempt + 1, message });

                    if (attempt < maxRetries) {
                        await new Promise(resolve => setTimeout(resolve, delayMs * Math.pow(2, attempt))); // Exponential backoff
                    }
                }
            }
            throw lastError || new Error("Failed after retries");
        }
    });
}
