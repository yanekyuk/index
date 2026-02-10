import { z } from "zod";
import type { ChatGraphCompositeDatabase } from "../interfaces/database.interface";
import type { Scraper } from "../interfaces/scraper.interface";

// ═══════════════════════════════════════════════════════════════════════════════
// COMPILED GRAPH TYPE
// ═══════════════════════════════════════════════════════════════════════════════

/** Minimal interface for an invokable compiled LangGraph. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type CompiledGraph = { invoke: (input: any) => Promise<any> };

// ═══════════════════════════════════════════════════════════════════════════════
// TOOL CONTEXT TYPES
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Resolved context available to every tool handler.
 * Contains the current user and optional index identity, resolved from DB at init.
 * The LLM can see this context (via system prompt) but cannot change it.
 */
export interface ResolvedToolContext {
  userId: string;
  userName: string;
  userEmail: string;
  indexId?: string;
  indexName?: string;
  /** True when chat is index-scoped and the user owns the index. */
  isOwner?: boolean;
}

/**
 * Dependencies passed when creating tools for a user session.
 * Includes DB adapters, embedder, and scraper.
 */
export interface ToolContext {
  userId: string;
  database: ChatGraphCompositeDatabase;
  embedder: import("../interfaces/embedder.interface").Embedder;
  scraper: Scraper;
  /** When set, chat is scoped to this index; tools use it as default for read_intents and create_intent. */
  indexId?: string;
}

// ═══════════════════════════════════════════════════════════════════════════════
// DEFINE TOOL TYPE
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Type for the `defineTool` closure created in `createChatTools`.
 * Auto-injects resolved context and provides uniform logging / error handling.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type DefineTool = <T extends z.ZodType>(opts: {
  name: string;
  description: string;
  querySchema: T;
  handler: (input: { context: ResolvedToolContext; query: z.infer<T> }) => Promise<string>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
}) => any;

// ═══════════════════════════════════════════════════════════════════════════════
// TOOL DEPENDENCIES
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Shared dependencies available to all tool domain factories.
 * Passed by `createChatTools` after compiling all subgraphs.
 */
export interface ToolDeps {
  database: ChatGraphCompositeDatabase;
  scraper: Scraper;
  graphs: {
    profile: CompiledGraph;
    intent: CompiledGraph;
    index: CompiledGraph;
    indexMembership: CompiledGraph;
    intentIndex: CompiledGraph;
    opportunity: CompiledGraph;
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// TOOL RESULT HELPERS
// ═══════════════════════════════════════════════════════════════════════════════

export function success<T>(data: T): string {
  return JSON.stringify({ success: true, data });
}

export function error(message: string): string {
  return JSON.stringify({ success: false, error: message });
}

/** Return needsClarification for missing required fields. */
export function needsClarification(params: {
  missingFields: string[];
  message: string;
}): string {
  return JSON.stringify({
    success: false,
    needsClarification: true,
    ...params,
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
// CONSTANTS & UTILITIES
// ═══════════════════════════════════════════════════════════════════════════════

/** Matches http/https URLs in text; captures full URL. */
const URL_IN_TEXT_REGEX = /https?:\/\/[^\s"'<>)\]]+/gi;

/**
 * Matches bare domain URLs without protocol (e.g. github.com/foo, www.example.com).
 * Requires at least a SLD.TLD pattern followed by optional path.
 * Negative lookbehind ensures we don't double-match URLs already caught by URL_IN_TEXT_REGEX.
 */
const BARE_URL_REGEX = /(?<!\w:\/\/)(?<![/\w])(?:www\.)?[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.(?:com|org|net|io|dev|co|ai|app|xyz|me|info|gg|so|sh|cc|ly|fm|tv|to|tech|design|network|world|edu|gov|mil|int|us|uk|eu|de|fr|ca|au|jp|cn|in|br|nl|se|no|fi|dk|ch|at|be|it|es|pt|pl|cz|ru|kr|tw|hk|sg|nz|za|mx|ar|cl|id|ph|th|vn|my|ie)(?:\/[^\s"'<>)\]]*)?/gi;

/** UUID v4 format: 8-4-4-4-12 hex chars (e.g. c2505011-2e45-426e-81dd-b9abb9b72023) */
export const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Resolves an array of index IDs to their display titles.
 * Skips any IDs that don't resolve (deleted or invalid indexes).
 */
export async function resolveIndexNames(
  database: { getIndex(id: string): Promise<{ id: string; title: string } | null> },
  indexIds: string[]
): Promise<string[]> {
  if (indexIds.length === 0) return [];
  const results = await Promise.all(
    indexIds.map(id => database.getIndex(id))
  );
  return results.filter(Boolean).map(idx => idx!.title);
}

/**
 * Normalize a URL string: if it lacks a protocol, prepend "https://".
 * Returns the normalized URL or null if the result is not a valid URL.
 */
export function normalizeUrl(raw: string): string | null {
  let url = raw.replace(/[.,;:!?)]+$/, "").trim();
  if (!/^https?:\/\//i.test(url)) {
    url = `https://${url}`;
  }
  try {
    new URL(url);
    return url;
  } catch {
    return null;
  }
}

/**
 * Extract unique, valid URLs from a string (e.g. user message or details).
 * Handles both full URLs (https://...) and bare domains (github.com/...).
 */
export function extractUrls(text: string): string[] {
  if (!text || typeof text !== "string") return [];

  const seen = new Set<string>();
  const out: string[] = [];

  // Pass 1: full protocol URLs
  const fullMatches = text.match(URL_IN_TEXT_REGEX) ?? [];
  for (const raw of fullMatches) {
    const url = normalizeUrl(raw);
    if (url && !seen.has(url)) {
      seen.add(url);
      out.push(url);
    }
  }

  // Pass 2: bare domain URLs (e.g. github.com/foo)
  const bareMatches = text.match(BARE_URL_REGEX) ?? [];
  for (const raw of bareMatches) {
    const url = normalizeUrl(raw);
    if (url && !seen.has(url)) {
      seen.add(url);
      out.push(url);
    }
  }

  return out;
}
