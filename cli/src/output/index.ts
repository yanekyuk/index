/**
 * Terminal output module — re-exports from base, markdown, and formatters.
 *
 * Consumers can continue using `import * as output from "./output"` and
 * `import { MarkdownRenderer } from "./output"` unchanged.
 */

export {
  // ANSI constants
  RESET,
  BOLD,
  DIM,
  ITALIC,
  RED,
  GREEN,
  YELLOW,
  BLUE,
  MAGENTA,
  CYAN,
  WHITE,
  GRAY,
  ORANGE,
  AGENT_TEXT,
  USER_PROMPT,

  // Basic messages
  error,
  success,
  info,
  warn,
  dim,
  heading,

  // Chat UI
  chatHeader,
  PROMPT_STR,

  // Streaming
  raw,
  status,
  clearStatus,
  toolActivity,

  // Tool descriptions
  humanizeToolName,

  // Helpers
  wordWrap,
  confidenceBar,
  padTo,
  stripAnsi,
} from "./base";

export { MarkdownRenderer } from "./markdown";

export type { ProfileData } from "./formatters";
export {
  profileCard,
  contactTable,
  sessionTable,
  intentTable,
  intentCard,
  opportunityTable,
  opportunityCard,
  networkTable,
  networkCard,
  memberTable,
  conversationTable,
  conversationCard,
  messageList,
} from "./formatters";
