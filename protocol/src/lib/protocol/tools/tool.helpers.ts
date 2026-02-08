import { z } from "zod";
import type { ChatGraphCompositeDatabase } from "../interfaces/database.interface";
import type { Scraper } from "../interfaces/scraper.interface";
import type { PendingConfirmation } from "../states/chat.state";

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
}

/**
 * Dependencies passed when creating tools for a user session.
 * Includes DB adapters, embedder, scraper, and confirmation helpers.
 */
export interface ToolContext {
  userId: string;
  database: ChatGraphCompositeDatabase;
  embedder: import("../interfaces/embedder.interface").Embedder;
  scraper: Scraper;
  /** When set, chat is scoped to this index; tools use it as default for read_intents and create_intent. */
  indexId?: string;
  /** Read pending confirmation (for confirm_action / cancel_action). */
  getPendingConfirmation?: () => PendingConfirmation | undefined;
  /** Set pending confirmation (for tools that require user confirm before update/delete). */
  setPendingConfirmation?: (p: PendingConfirmation | undefined) => void;
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
  getPendingConfirmation?: () => PendingConfirmation | undefined;
  setPendingConfirmation?: (p: PendingConfirmation | undefined) => void;
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

/** Return needsConfirmation so the agent asks the user before calling confirm_action. */
export function needsConfirmation(params: {
  confirmationId: string;
  action: string;
  resource: string;
  summary: string;
}): string {
  return JSON.stringify({
    success: false,
    needsConfirmation: true,
    ...params,
  });
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

/** Five minutes in ms for confirmation expiry. */
export const CONFIRMATION_EXPIRY_MS = 5 * 60 * 1000;

/** Matches http/https URLs in text; captures full URL. */
const URL_IN_TEXT_REGEX = /https?:\/\/[^\s"'<>)\]]+/gi;

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
 * Extract unique, valid URLs from a string (e.g. user message or details).
 */
export function extractUrls(text: string): string[] {
  if (!text || typeof text !== "string") return [];
  const matches = text.match(URL_IN_TEXT_REGEX) ?? [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of matches) {
    const url = raw.replace(/[.,;:!?)]+$/, "").trim();
    try {
      new URL(url);
      if (!seen.has(url)) {
        seen.add(url);
        out.push(url);
      }
    } catch {
      // skip invalid
    }
  }
  return out;
}
