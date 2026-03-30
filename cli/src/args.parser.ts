/**
 * Parsed CLI command with all possible options.
 *
 * The `command` field determines which handler runs. Optional fields
 * are populated only when relevant to the active command.
 */
export interface ParsedCommand {
  command: "login" | "logout" | "chat" | "profile" | "help" | "version" | "unknown";
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
  subcommand?: "show" | "sync";
  /** Target user ID for `profile show <user-id>`. */
  userId?: string;
}

const KNOWN_COMMANDS = new Set(["login", "logout", "chat", "profile", "help", "version"]);

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
    } else if (arg.startsWith("--")) {
      // Skip unknown flags
      i++;
    } else {
      positionals.push(arg);
      i++;
    }
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

  return result;
}
