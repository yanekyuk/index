import { z } from "zod";
import type { DefineTool, ToolDeps } from "./tool.helpers";
import { success, error, normalizeUrl } from "./tool.helpers";

export function createUtilityTools(defineTool: DefineTool, deps: ToolDeps) {
  const { scraper } = deps;

  const scrapeUrl = defineTool({
    name: "scrape_url",
    description: "Extracts text content from a URL (articles, profiles, documentation, etc.). Use this to read web pages, LinkedIn/GitHub profiles, or any public web content. The URL does not need http:// or https:// — bare domains like github.com/user/repo work fine. Pass 'objective' when you know the downstream use: e.g. 'User wants to create an intent from this link (project/repo).' or 'User wants to update their profile from this page.' — this returns content better suited for that use.",
    querySchema: z.object({
      url: z.string().describe("The URL to scrape (protocol optional — e.g. 'github.com/user/repo' is fine)"),
      objective: z.string().optional().describe("Optional: why we're scraping. E.g. 'User wants to create an intent from this link' or 'User wants to update their profile from this page'. Omit for generic extraction."),
    }),
    handler: async ({ context: _context, query }) => {
      const normalizedUrl = normalizeUrl(query.url);
      if (!normalizedUrl) {
        return error("Invalid URL format. Please provide a valid URL (e.g. 'github.com/user/repo' or 'https://example.com').");
      }

      const content = await scraper.extractUrlContent(normalizedUrl, {
        objective: query.objective?.trim() || undefined,
      });

      if (!content) {
        return error("Couldn't extract content from that URL. It may be blocked, require login, or have no extractable text.");
      }

      const truncatedContent = content.length > 10000
        ? content.substring(0, 10000) + "\n\n[Content truncated...]"
        : content;

      return success({
        url: normalizedUrl,
        contentLength: content.length,
        content: truncatedContent,
      });
    },
  });

  return [scrapeUrl] as const;
}
