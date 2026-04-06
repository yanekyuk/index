/**
 * Scrape command handler for the Index CLI.
 *
 * Extracts content from a URL using the scrape_url tool.
 */
import type { ApiClient } from "./api.client";
import * as output from "./output";

/**
 * Handle the scrape command — extract content from a URL.
 *
 * @param client - Authenticated API client.
 * @param positionals - Positional arguments (first is the URL).
 * @param options - Additional options (json, objective).
 */
export async function handleScrape(
  client: ApiClient,
  positionals: string[],
  options: { json?: boolean; objective?: string },
): Promise<void> {
  const url = positionals[0];
  if (!url) { output.error("Usage: index scrape <url> [--objective <text>]", 1); return; }
  output.info(`Scraping ${url}...`);
  const result = await client.callTool("scrape_url", { url, objective: options.objective });
  if (options.json) { console.log(JSON.stringify(result)); return; }
  if (!result.success) { output.error(result.error ?? "Scrape failed", 1); return; }
  const data = result.data as { url: string; contentLength: number; content: string };
  output.heading(`Content from ${data.url}`);
  console.log(data.content);
  output.dim(`\n  ${data.contentLength} characters extracted`);
  console.log();
}
