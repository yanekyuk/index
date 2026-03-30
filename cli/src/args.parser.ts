/**
 * Parsed CLI command with all possible options.
 *
 * The `command` field determines which handler runs. Optional fields
 * are populated only when relevant to the active command.
 */
export interface ParsedCommand {
  command: "login" | "logout" | "chat" | "profile" | "intent" | "opportunity" | "help" | "version" | "unknown";
  /** Chat message for one-shot mode. */
  message?: string;
  /** Resume a specific chat session. */
  sessionId?: string;
  /** List chat sessions instead of starting a conversation. */
  list: boolean;
  /** Override the API base URL. */
  apiUrl?: string;
  /** Manually provided bearer token for login. */
  token?: string;
  /** The unrecognized command string (when command === "unknown"). */
  unknown?: string;
  /** Profile subcommand ("show" or "sync"). */
  subcommand?: "show" | "sync" | "list" | "show" | "create" | "archive" | "accept" | "reject";
  /** Target user ID for `profile show <user-id>`. */
  userId?: string;
  /** Intent ID for show/archive subcommands. */
  intentId?: string;
  /** Content string for intent create subcommand. */
  intentContent?: string;
  /** Include archived intents in listing. */
  archived?: boolean;
  /** Positional ID argument for subcommands that require a target (e.g. opportunity show <id>). */
  targetId?: string;
  /** Status filter for list subcommands (e.g. --status pending). */
  status?: string;
  /** Limit for list subcommands (e.g. --limit 10). */
  limit?: number;
}

const KNOWN_COMMANDS = new Set(["login", "logout", "chat", "profile", "intent", "opportunity", "help", "version"]);

const OPPORTUNITY_SUBCOMMANDS = new Set(["list", "show", "accept", "reject"]);

/**
 * Parse raw CLI arguments into a structured command object.
 *
 * Arguments follow the pattern: `index <command> [options] [positional]`.
 * Bun strips the binary name and script path, so `args` starts at the
 * first user-provided token.
 *
 * @param args - CLI arguments (typically `process.argv.slice(2)`).
 * @returns Parsed command with options.
 */
export function parseArgs(args: string[]): ParsedCommand {
  const result: ParsedCommand = {
    command: "help",
    list: false,
  };

  if (args.length === 0) {
    return result;
  }

  const first = args[0];

  // Global flags
  if (first === "--help" || first === "-h") {
    result.command = "help";
    return result;
  }
  if (first === "--version" || first === "-v") {
    result.command = "version";
    return result;
  }

  // Route to command
  if (!KNOWN_COMMANDS.has(first)) {
    result.command = "unknown";
    result.unknown = first;
    return result;
  }

  result.command = first as ParsedCommand["command"];

  // Parse remaining args for the command
  let i = 1;
  const positionals: string[] = [];

  while (i < args.length) {
    const arg = args[i];

    if (arg === "--list" || arg === "-l") {
      result.list = true;
      i++;
    } else if (arg === "--session" || arg === "-s") {
      result.sessionId = args[i + 1];
      i += 2;
    } else if (arg === "--api-url") {
      result.apiUrl = args[i + 1];
      i += 2;
    } else if (arg === "--token" || arg === "-t") {
      result.token = args[i + 1];
      i += 2;
    } else if (arg === "--archived") {
      result.archived = true;
      i++;
    } else if (arg === "--status") {
      result.status = args[i + 1];
      i += 2;
    } else if (arg === "--limit") {
      result.limit = parseInt(args[i + 1], 10);
      i += 2;
    } else if (arg.startsWith("--")) {
      // Skip unknown flags
      i++;
    } else {
      positionals.push(arg);
      i++;
    }
  }

  // Opportunity subcommand parsing
  if (result.command === "opportunity") {
    const sub = positionals[0];
    if (sub && OPPORTUNITY_SUBCOMMANDS.has(sub)) {
      result.subcommand = sub;
      // Second positional is the target ID (for show/accept/reject)
      if (positionals[1]) {
        result.targetId = positionals[1];
      }
    }
    return result;
  }

  // First positional after command is the message (for chat)
  if (positionals.length > 0 && result.command === "chat") {
    result.message = positionals.join(" ");
  }

  // Profile subcommands: "show <user-id>" or "sync"
  if (result.command === "profile" && positionals.length > 0) {
    const sub = positionals[0];
    if (sub === "show") {
      result.subcommand = "show";
      if (positionals[1]) {
        result.userId = positionals[1];
      }
    } else if (sub === "sync") {
      result.subcommand = "sync";
    }
  }

  // Intent subcommand parsing
  if (result.command === "intent") {
    parseIntentArgs(positionals, result);
  }

  return result;
}

const INTENT_SUBCOMMANDS = new Set(["list", "show", "create", "archive"]);

/**
 * Parse intent-specific positional arguments into subcommand, ID, or content.
 *
 * @param positionals - Positional arguments after flags have been extracted.
 * @param result - The parsed command object to populate.
 */
function parseIntentArgs(positionals: string[], result: ParsedCommand): void {
  if (positionals.length === 0) return;

  const sub = positionals[0];
  if (!INTENT_SUBCOMMANDS.has(sub)) return;

  result.subcommand = sub as ParsedCommand["subcommand"];
  const rest = positionals.slice(1);

  switch (result.subcommand) {
    case "show":
    case "archive":
      result.intentId = rest[0];
      break;
    case "create":
      if (rest.length > 0) {
        result.intentContent = rest.join(" ");
      }
      break;
  }
}
