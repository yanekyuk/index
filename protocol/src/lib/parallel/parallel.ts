
const PARALLEL_API_URL = 'https://api.parallel.ai/v1beta/search';

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
