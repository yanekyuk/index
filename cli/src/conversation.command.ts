/**
 * Conversation command handlers for the Index CLI.
 *
 * Implements: list, with, show, send, stream subcommands
 * for H2H (Human-to-Human) direct messaging via the unified
 * /api/conversations/* endpoints.
 */

import type { ApiClient } from "./api.client";
import * as output from "./output";

const CONVERSATION_HELP = `
Conversation Commands:
  index conversation list                  List your conversations
  index conversation with <user-id>        Open or resume a DM with a user
  index conversation show <id>             Show messages in a conversation
  index conversation show <id> --limit <n> Limit number of messages
  index conversation send <id> <message>   Send a message
  index conversation stream                Listen for real-time events (SSE)
`;

/**
 * Route a conversation subcommand to the appropriate handler.
 *
 * @param client - Authenticated API client.
 * @param subcommand - The subcommand (list, with, show, send, stream).
 * @param positionals - Positional arguments after the subcommand.
 * @param options - Additional options (e.g. limit).
 */
export async function handleConversation(
  client: ApiClient,
  subcommand: string | undefined,
  positionals: string[],
  options?: { limit?: number },
): Promise<void> {
  if (!subcommand) {
    console.log(CONVERSATION_HELP);
    return;
  }

  switch (subcommand) {
    case "list":
      await conversationList(client);
      return;
    case "with":
      await conversationWith(client, positionals[0]);
      return;
    case "show":
      await conversationShow(client, positionals[0], options?.limit);
      return;
    case "send":
      await conversationSend(client, positionals[0], positionals.slice(1));
      return;
    case "stream":
      await conversationStream(client);
      return;
    default:
      output.error(`Unknown conversation subcommand: ${subcommand}`, 1);
  }
}

/**
 * List conversations for the authenticated user.
 */
async function conversationList(client: ApiClient): Promise<void> {
  const conversations = await client.listConversations();

  output.heading("Conversations");
  output.conversationTable(conversations);
  console.log();
}

/**
 * Get or create a DM with a peer user.
 */
async function conversationWith(client: ApiClient, userId: string | undefined): Promise<void> {
  if (!userId) {
    output.error("Usage: index conversation with <user-id>", 1);
    return;
  }

  const conversation = await client.getOrCreateDM(userId);
  output.conversationCard(conversation);
}

/**
 * Show messages in a conversation.
 */
async function conversationShow(
  client: ApiClient,
  id: string | undefined,
  limit?: number,
): Promise<void> {
  if (!id) {
    output.error("Usage: index conversation show <id>", 1);
    return;
  }

  const messages = await client.getMessages(id, { limit: limit ?? 20 });

  output.heading("Messages");
  output.messageList(messages);
}

/**
 * Send a text message in a conversation.
 */
async function conversationSend(
  client: ApiClient,
  id: string | undefined,
  messageParts: string[],
): Promise<void> {
  if (!id) {
    output.error("Usage: index conversation send <id> <message>", 1);
    return;
  }

  if (messageParts.length === 0) {
    output.error("Missing message. Usage: index conversation send <id> <message>", 1);
    return;
  }

  const text = messageParts.join(" ");
  const msg = await client.sendMessage(id, text);
  output.success(`Message sent (${msg.id})`);
}

/**
 * Open an SSE stream for real-time conversation events.
 */
async function conversationStream(client: ApiClient): Promise<void> {
  output.info("Connecting to conversation stream...");
  output.dim("Press Ctrl+C to stop.\n");

  const response = await client.streamConversationEvents();

  if (!response.body) {
    output.error("No response body from stream endpoint.", 1);
    return;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      while (buffer.includes("\n\n")) {
        const idx = buffer.indexOf("\n\n");
        const raw = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);

        for (const line of raw.split("\n")) {
          if (line.startsWith(":")) continue; // keepalive comment
          if (!line.startsWith("data:")) continue;

          const jsonStr = line.slice("data:".length).trim();
          if (!jsonStr) continue;

          try {
            const event = JSON.parse(jsonStr) as Record<string, unknown>;
            const type = event.type as string;

            if (type === "connected") {
              output.success("Connected to conversation stream.");
            } else {
              output.dim(`[${type}] ${JSON.stringify(event)}`);
            }
          } catch {
            // Malformed JSON — skip
          }
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}
