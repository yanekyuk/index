/**
 * Chat command implementation — renders SSE streams from the protocol
 * server to the terminal and manages interactive REPL sessions.
 */

import { createInterface } from "node:readline/promises";

import type { ApiClient } from "./api.client";
import * as output from "./output";
import { MarkdownRenderer } from "./output";

/** Result of processing one SSE stream. */
export interface StreamResult {
  sessionId?: string;
  response?: string;
  title?: string;
  error?: string;
}

/** Callbacks for stream rendering. */
export interface StreamCallbacks {
  onToken: (text: string) => void;
  onStatus?: (message: string) => void;
  /**
   * Tool activity from the protocol — uses the server's own human-friendly
   * description string. Phase is "start" or "end".
   */
  onToolActivity?: (description: string, phase: "start" | "end", success?: boolean) => void;
  /** Called when the agent detects a hallucination and resets its response. */
  onResponseReset?: (reason?: string) => void;
}

/**
 * Route a chat subcommand to the appropriate handler.
 *
 * @param client - Authenticated API client.
 * @param options - Chat options (list, message, sessionId).
 */
export async function handleChat(
  client: ApiClient,
  options: { list: boolean; message?: string; sessionId?: string },
): Promise<void> {
  if (options.list) {
    await chatList(client);
  } else if (options.message) {
    await chatOneShot(client, options.message, options.sessionId);
  } else {
    await chatRepl(client, options.sessionId);
  }
}

/**
 * List all chat sessions.
 */
async function chatList(client: ApiClient): Promise<void> {
  const sessions = await client.listSessions();
  output.heading("Chat Sessions");
  output.sessionTable(sessions);
  console.log();
}

/**
 * Send a single message and print the streamed response.
 */
async function chatOneShot(
  client: ApiClient,
  message: string,
  sessionId?: string,
): Promise<void> {
  const response = await client.streamChat({ message, sessionId });

  if (!response.ok) {
    handleStreamError(response);
    return;
  }

  const result = await streamToTerminal(response);

  if (result.error) {
    output.error(result.error, 1);
    return;
  }

  if (result.sessionId) {
    output.dim(`\nSession: ${result.sessionId}`);
  }
}

/**
 * Enter an interactive REPL chat session.
 */
async function chatRepl(
  client: ApiClient,
  sessionId?: string,
): Promise<void> {
  let currentSessionId = sessionId;

  output.chatHeader();

  const PROMPT_STR = output.PROMPT_STR;

  const rl = createInterface({
    input: process.stdin,
    output: process.stderr,
    terminal: true,
  });
  rl.setPrompt(PROMPT_STR);
  rl.prompt();

  try {
    for await (const line of rl) {
      const input = line.trim();
      if (!input) {
        rl.prompt();
        continue;
      }
      if (input === "exit" || input === "quit") break;

      const response = await client.streamChat({
        message: input,
        sessionId: currentSessionId,
      });

      if (!response.ok) {
        if (response.status === 401) {
          output.error(
            "Session expired. Run `index login` to re-authenticate.",
            1,
          );
          return;
        }
        const body = (await response.json().catch(() => ({}))) as {
          error?: string;
        };
        output.error(body.error ?? `HTTP ${response.status}`);
        rl.prompt();
        continue;
      }

      const result = await streamToTerminal(response);

      if (result.error) {
        output.error(result.error);
      }

      // Track session for continuity
      if (result.sessionId) {
        currentSessionId = result.sessionId;
      }

      process.stderr.write("\n");
      rl.prompt();
    }
  } finally {
    rl.close();
  }

  process.stderr.write("\n");
  output.dim("Goodbye!");
}

// ── Stream helpers ──────────────────────────────────────────────────

/**
 * Stream an SSE response to the terminal with formatting.
 * Handles status messages, tool activity, and markdown rendering.
 */
async function streamToTerminal(response: Response): Promise<StreamResult> {
  let hasTokens = false;
  const md = new MarkdownRenderer();
  let lastToolDesc = "";

  const result = await renderSSEStream(response, {
    onToken(text) {
      if (!hasTokens) {
        output.clearStatus();
        hasTokens = true;
      }
      md.write(text);
      // Once tokens flow, clear last tool so it can show again after new text
      lastToolDesc = "";
    },
    onStatus(msg) {
      if (!hasTokens) {
        output.status(msg);
      }
    },
    onToolActivity(description, phase) {
      if (phase === "start") {
        const friendly = output.humanizeToolName(description);
        // Skip if identical to the last tool line with no text in between
        if (friendly === lastToolDesc) return;
        lastToolDesc = friendly;
        // Finalize any buffered markdown before the tool line
        md.finalize();
        hasTokens = false;
        output.toolActivity(friendly);
      }
    },
    onResponseReset(reason) {
      md.reset(reason);
      hasTokens = false;
    },
  });

  md.finalize();
  output.clearStatus();
  if (hasTokens) {
    console.log(); // newline after streamed tokens
  }

  return result;
}

/** Handle non-OK stream responses. */
async function handleStreamError(response: Response): Promise<void> {
  if (response.status === 401) {
    output.error(
      "Session expired or invalid. Run `index login` to re-authenticate.",
      1,
    );
  }
  const body = (await response.json().catch(() => ({}))) as {
    error?: string;
  };
  output.error(body.error ?? `HTTP ${response.status}`, 1);
}

// ── SSE stream parser ──────────────────────────────────────────────

/**
 * Read an SSE Response body, dispatch token content to callbacks, and
 * return a summary result once the stream ends.
 *
 * The protocol emits `tool_activity` events with human-friendly descriptions
 * (e.g. "Proposing a new signal for game development"). These are the
 * canonical tool call indicators — `tool_start`/`tool_end` events are only
 * used to track the insideToolCall state for token suppression, not displayed.
 */
export async function renderSSEStream(
  response: Response,
  callbacks: StreamCallbacks,
): Promise<StreamResult> {
  const { onToken, onStatus, onToolActivity, onResponseReset } = callbacks;
  const result: StreamResult = {};

  if (!response.body) {
    result.error = "No response body";
    return result;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  /** Tracks whether we're inside a tool call (suppress tool-name tokens). */
  let insideToolCall = false;
  /** Maps toolName -> human-friendly description from the start event. */
  const toolDescriptions = new Map<string, string>();

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      // Process complete events (delimited by double newline)
      while (buffer.includes("\n\n")) {
        const idx = buffer.indexOf("\n\n");
        const raw = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);

        for (const line of raw.split("\n")) {
          if (!line.startsWith("data:")) continue;

          const jsonStr = line.slice("data:".length).trim();
          if (!jsonStr) continue;

          try {
            const event = JSON.parse(jsonStr) as Record<string, unknown>;
            const type = event.type as string;

            switch (type) {
              case "token": {
                if (typeof event.content !== "string") break;
                if (insideToolCall) break;
                onToken(event.content);
                break;
              }

              case "status":
                if (onStatus && typeof event.message === "string") {
                  onStatus(event.message);
                }
                break;

              case "tool_activity": {
                const phase = event.phase as string;
                const toolName = typeof event.toolName === "string" ? event.toolName : "";
                const desc = typeof event.description === "string" ? event.description : undefined;

                if (phase === "start") {
                  insideToolCall = true;
                  // Store the human-friendly description from the start event
                  if (desc && toolName) {
                    toolDescriptions.set(toolName, desc);
                  }
                  if (onToolActivity && desc) {
                    onToolActivity(desc, "start");
                  }
                } else if (phase === "end") {
                  insideToolCall = false;
                  // Reuse the start description — end events often have the raw tool name
                  const startDesc = toolName ? toolDescriptions.get(toolName) : undefined;
                  if (onToolActivity) {
                    onToolActivity(startDesc ?? desc ?? toolName, "end", event.success !== false);
                  }
                  if (toolName) toolDescriptions.delete(toolName);
                }
                break;
              }

              case "tool_start":
                // Only used for token suppression — tool_activity handles display.
                insideToolCall = true;
                break;

              case "tool_end":
                insideToolCall = false;
                break;

              case "llm_start":
                insideToolCall = false;
                break;

              case "response_reset":
                result.response = undefined;
                if (onResponseReset) {
                  onResponseReset(typeof event.reason === "string" ? event.reason : undefined);
                }
                break;

              case "done":
                result.sessionId =
                  typeof event.sessionId === "string"
                    ? event.sessionId
                    : undefined;
                result.response =
                  typeof event.response === "string"
                    ? event.response
                    : undefined;
                result.title =
                  typeof event.title === "string" ? event.title : undefined;
                break;

              case "error":
                result.error =
                  typeof event.message === "string"
                    ? event.message
                    : "Unknown stream error";
                break;

              default:
                break;
            }
          } catch {
            // Malformed JSON line — skip.
          }
        }
      }
    }
  } finally {
    reader.releaseLock();
  }

  return result;
}
