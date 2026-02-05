import Parallel from 'parallel-web';
import { log } from '../log';
const logger = log.lib.from("lib/parallel/parallel.ts");

const PARALLEL_API_URL = 'https://api.parallel.ai/v1beta/search';
const PARALLELS_API_KEY = process.env.PARALLELS_API_KEY || '';

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

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Parallel Search API failed: ${response.status} ${response.statusText} - ${errorText}`);
  }

  return await response.json() as ParallelSearchResponse;
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
    logger.info('Extracting URL content', { url, hasObjective: !!options?.objective });
    
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
    
    logger.info('Parallel extract response received', { url, resultsCount: extract.results?.length || 0 });
    
    if (extract.results && extract.results.length > 0) {
      const result = extract.results[0];
      // Access content from result - check common property names
      const content = (result as any).content || (result as any).excerpts?.[0] || (result as any).excerpt || (result as any).markdown || null;
      logger.info('Extracted content', { url, contentLength: content?.length || 0, resultKeys: Object.keys(result) });
      return content;
    }

    logger.warn('No results in extract response', { url, extract });
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
