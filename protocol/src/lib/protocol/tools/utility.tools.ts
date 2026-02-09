import { z } from "zod";
import type { DefineTool, ToolDeps } from "./tool.helpers";
import { success, error } from "./tool.helpers";

export function createUtilityTools(defineTool: DefineTool, deps: ToolDeps) {
  const { scraper } = deps;

  const scrapeUrl = defineTool({
    name: "scrape_url",
    description: "Extracts text content from a URL (articles, profiles, documentation, etc.). Use this to read web pages, LinkedIn/GitHub profiles, or any public web content. Pass 'objective' when you know the downstream use: e.g. 'User wants to create an intent from this link (project/repo).' or 'User wants to update their profile from this page.' — this returns content better suited for that use.",
    querySchema: z.object({
      url: z.string().describe("The URL to scrape"),
      objective: z.string().optional().describe("Optional: why we're scraping. E.g. 'User wants to create an intent from this link' or 'User wants to update their profile from this page'. Omit for generic extraction."),
    }),
    handler: async ({ context: _context, query }) => {
      try {
        new URL(query.url);
      } catch {
        return error("Invalid URL format. Please provide a valid URL starting with http:// or https://");
      }

      const content = await scraper.extractUrlContent(query.url, {
        objective: query.objective?.trim() || undefined,
      });

      if (!content) {
        return error("Couldn't extract content from that URL. It may be blocked, require login, or have no extractable text.");
      }

      const truncatedContent = content.length > 10000
        ? content.substring(0, 10000) + "\n\n[Content truncated...]"
        : content;

      return success({
        url: query.url,
        contentLength: content.length,
        content: truncatedContent,
      });
    },
  });

  return [scrapeUrl] as const;
}
