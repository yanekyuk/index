/**
 * Intent (signal) command handlers for the Index CLI.
 *
 * Implements: list, show, create, archive subcommands.
 * Follows the same handleX(client, subcommand, positionals, options)
 * pattern as network.command.ts and conversation.command.ts.
 */

import type { ApiClient } from "./api.client";
import * as output from "./output";

const INTENT_HELP = `
Usage:
  index intent list [--archived] [--limit <n>]  List your signals
  index intent show <id>                        Show signal details
  index intent create <content>                 Create a signal from text
  index intent archive <id>                     Archive a signal
`;

/**
 * Route an intent subcommand to the appropriate handler.
 *
 * @param client - Authenticated API client.
 * @param subcommand - The subcommand (list, show, create, archive).
 * @param options - Additional options (intentId, intentContent, archived, limit).
 */
export async function handleIntent(
  client: ApiClient,
  subcommand: string | undefined,
  options: {
    intentId?: string;
    intentContent?: string;
    archived?: boolean;
    limit?: number;
  },
): Promise<void> {
  if (!subcommand) {
    console.log(INTENT_HELP);
    return;
  }

  switch (subcommand) {
    case "list": {
      const result = await client.listIntents({
        archived: options.archived,
        limit: options.limit,
      });
      output.heading("Signals");
      output.intentTable(result.intents);
      if (result.pagination.total > 0) {
        output.dim(
          `\n  Page ${result.pagination.page} of ${result.pagination.totalPages} (${result.pagination.total} total)`,
        );
      }
      console.log();
      return;
    }

    case "show": {
      if (!options.intentId) {
        output.error("Missing signal ID. Usage: index intent show <id>", 1);
        return;
      }
      const intent = await client.getIntent(options.intentId);
      output.intentCard(intent);
      return;
    }

    case "create": {
      if (!options.intentContent) {
        output.error("Missing content. Usage: index intent create <content>", 1);
        return;
      }
      output.info("Processing signal...");
      const result = await client.processIntent(options.intentContent);
      output.success("Signal processed successfully.");
      if (result.message) {
        output.dim(`  ${result.message}`);
      }
      return;
    }

    case "archive": {
      if (!options.intentId) {
        output.error("Missing signal ID. Usage: index intent archive <id>", 1);
        return;
      }
      await client.archiveIntent(options.intentId);
      output.success(`Signal ${options.intentId} archived.`);
      return;
    }
  }
}
