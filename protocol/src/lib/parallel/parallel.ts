import Parallel from 'parallel-web';
import { log } from '../log';
const logger = log.lib.from("lib/parallel/parallel.ts");

const PARALLEL_API_URL = 'https://api.parallel.ai/v1beta/search';
const PARALLELS_API_KEY = process.env.PARALLELS_API_KEY || '';

/** Max retries when Parallel returns 429 Too Many Requests. */
const RATE_LIMIT_MAX_RETRIES = 3;
/** Default wait (ms) when Retry-After header is missing. 60s aligns with per-minute limits. */
const RATE_LIMIT_DEFAULT_DELAY_MS = 60_000;

function getRateLimitDelayMs(response: Response): number {
  const retryAfter = response.headers.get('Retry-After');
  if (retryAfter) {
    const seconds = parseInt(retryAfter, 10);
    if (!Number.isNaN(seconds)) return Math.min(seconds * 1000, 300_000); // cap 5 min
  }
  return RATE_LIMIT_DEFAULT_DELAY_MS;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRateLimitError(error: unknown): boolean {
  if (error instanceof Error) {
    const msg = error.message.toLowerCase();
    if (msg.includes('429') || msg.includes('rate limit') || msg.includes('too many requests')) return true;
  }
  const anyErr = error as { status?: number; statusCode?: number };
  return anyErr?.status === 429 || anyErr?.statusCode === 429;
}

// Initialize Parallel client
const parallelClient = new Parallel({
  apiKey: PARALLELS_API_KEY,
});

export interface ParallelSearchResponse {
  search_id: string;
  results: {
    url: string;
    title: string;
    publish_date: null;
    excerpts: Array<string>
  }[]
}

export type ParallelSearchRequest = ParallelSearchRequestString | ParallelSearchRequestStruct;

export interface ParallelSearchRequestString {
  objective: string
}

export interface ParallelSearchRequestStruct {
  name?: string;
  email?: string;
  linkedin?: string;
  twitter?: string;
  github?: string;
  websites?: string[];
}

/**
 * Searches for a user using Parallel.ai API.
 * @param objective The specific query, e.g. 'seren sandikci, "seren@index.network"'
 */
export async function searchUser(request: ParallelSearchRequest): Promise<ParallelSearchResponse> {
  const apiKey = process.env.PARALLELS_API_KEY;
  if (!apiKey) {
    throw new Error('PARALLELS_API_KEY is not defined');
  }

  let objective: string = '';
  if ('objective' in request) {
    objective = request.objective;
  } else {
    objective = `Find information about the person named ${request.name || 'Unknown'}.`;
    if (request.email) objective += `\nEmail: ${request.email}`;
    if (request.linkedin) objective += `\nLinkedIn: ${request.linkedin}`;
    if (request.twitter) objective += `\nTwitter: ${request.twitter}`;
    if (request.github) objective += `\nGitHub: ${request.github}`;
    if (request.websites?.length) objective += `\nWebsites: ${request.websites.join(', ')}`;
  }

  for (let attempt = 1; attempt <= RATE_LIMIT_MAX_RETRIES; attempt++) {
    const response = await fetch(PARALLEL_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'parallel-beta': 'search-extract-2025-10-10'
      },
      body: JSON.stringify({
        mode: 'one-shot',
        search_queries: null,
        max_results: 10,
        objective,
      })
    });

    if (response.status === 429) {
      if (attempt === RATE_LIMIT_MAX_RETRIES) {
        const errorText = await response.text();
        throw new Error(`Parallel Search API rate limited (429) after ${RATE_LIMIT_MAX_RETRIES} retries - ${errorText}`);
      }
      const delayMs = getRateLimitDelayMs(response);
      logger.warn('Parallel Search rate limited (429), retrying after delay', {
        attempt,
        maxRetries: RATE_LIMIT_MAX_RETRIES,
        delayMs,
      });
      await sleep(delayMs);
      continue;
    }

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Parallel Search API failed: ${response.status} ${response.statusText} - ${errorText}`);
    }

    return await response.json() as ParallelSearchResponse;
  }

  throw new Error('Parallel Search API failed after retries');
}

/**
 * Options for URL content extraction (objective-aware scraping).
 */
export interface ExtractUrlContentOptions {
  /**
   * Optional natural-language objective (e.g. "create an intent from this project/repo",
   * "update my profile from this page"). When provided, the extract API may tailor content.
   */
  objective?: string;
}

/**
 * Extracts content from a URL using Parallel.ai API.
 * @param url The URL to extract content from
 * @param options Optional. Pass objective to get content tailored for intent or profile use.
 * @returns The extracted content as a string, or null if extraction failed
 */
export async function extractUrlContent(url: string, options?: ExtractUrlContentOptions): Promise<string | null> {
  if (!PARALLELS_API_KEY) {
    throw new Error('PARALLELS_API_KEY not configured');
  }

  const objective = options?.objective?.trim() || 'all';

  try {
    logger.verbose('Extracting URL content', { url, hasObjective: !!options?.objective });

    for (let attempt = 1; attempt <= RATE_LIMIT_MAX_RETRIES; attempt++) {
      try {
        const extract = await parallelClient.beta.extract({
          urls: [url],
          excerpts: true,
          full_content: true,
          objective,
          fetch_policy: {
            disable_cache_fallback: false,
            max_age_seconds: 5184000, // 60 days
            timeout_seconds: 30,
          },
        });

        logger.verbose('Parallel extract response received', { url, resultsCount: extract.results?.length || 0 });

        if (extract.results && extract.results.length > 0) {
          const result = extract.results[0];
          // Access content from result - check common property names
          const content = (result as any).content || (result as any).excerpts?.[0] || (result as any).excerpt || (result as any).markdown || null;
          logger.verbose('Extracted content', { url, contentLength: content?.length || 0, resultKeys: Object.keys(result) });
          return content;
        }

        logger.warn('No results in extract response', { url, extract });
        return null;
      } catch (extractError) {
        if (isRateLimitError(extractError) && attempt < RATE_LIMIT_MAX_RETRIES) {
          const delayMs = RATE_LIMIT_DEFAULT_DELAY_MS;
          logger.warn('Parallel Extract rate limited, retrying after delay', {
            url,
            attempt,
            maxRetries: RATE_LIMIT_MAX_RETRIES,
            delayMs,
          });
          await sleep(delayMs);
          continue;
        }
        throw extractError;
      }
    }
    return null;
  } catch (error) {
    const errorDetails = error instanceof Error ? {
      message: error.message,
      name: error.name,
      stack: error.stack,
    } : { error };
    logger.error('Failed to extract URL content', { url, error: errorDetails });
    return null;
  }
}

// Export the parallel client for direct access if needed
export { parallelClient };
