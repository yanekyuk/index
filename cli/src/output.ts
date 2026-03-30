/**
 * Terminal output helpers for consistent CLI formatting.
 *
 * Uses ANSI escape codes for colors and styling. All user-facing
 * output goes through these helpers to keep formatting consistent.
 */

// ── ANSI codes ──────────────────────────────────────────────────────

const RESET = "\x1b[0m";
const BOLD = "\x1b[1m";
const DIM = "\x1b[2m";
const ITALIC = "\x1b[3m";
const RED = "\x1b[31m";
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const BLUE = "\x1b[34m";
const MAGENTA = "\x1b[35m";
const CYAN = "\x1b[36m";
const WHITE = "\x1b[37m";
const GRAY = "\x1b[90m";

// 256-color for brand tones
/** Claude orange (208) for tool call indicators. */
const ORANGE = "\x1b[38;5;208m";
/** Soft white for agent responses — distinct from bright user prompt. */
const AGENT_TEXT = "\x1b[38;5;252m";
/** Bright cyan for user prompt. */
const USER_PROMPT = CYAN;

// ── Basic messages ──────────────────────────────────────────────────

/** Print an error message to stderr and optionally exit. */
export function error(message: string, exitCode?: number): void {
  console.error(`${RED}${BOLD}error${RESET}${RED}: ${message}${RESET}`);
  if (exitCode !== undefined) {
    process.exit(exitCode);
  }
}

/** Print a success message. */
export function success(message: string): void {
  console.log(`${GREEN}${BOLD}+${RESET} ${message}`);
}

/** Print an informational message. */
export function info(message: string): void {
  console.log(`${CYAN}${message}${RESET}`);
}

/** Print a warning message. */
export function warn(message: string): void {
  console.log(`${YELLOW}${message}${RESET}`);
}

/** Print a dim/secondary message. */
export function dim(message: string): void {
  console.log(`${GRAY}${message}${RESET}`);
}

/** Print a bold heading. */
export function heading(message: string): void {
  console.log(`\n${BOLD}${message}${RESET}`);
}

// ── Chat header ─────────────────────────────────────────────────────

/** Print the branded chat header. */
export function chatHeader(): void {
  console.log();
  console.log(`  ${BOLD}${CYAN}I N D E X${RESET}  ${GRAY}chat${RESET}`);
  console.log(`  ${GRAY}─────────────────────────────────────${RESET}`);
  console.log(`  ${GRAY}Type your message. "exit" or Ctrl+C to quit.${RESET}`);
  console.log();
}

// ── Chat prompt ─────────────────────────────────────────────────────

/** The prompt string for readline. */
export const PROMPT_STR = `${USER_PROMPT}${BOLD}> ${RESET}`;

// ── Streaming output ────────────────────────────────────────────────

/** Write raw text to stdout. */
export function raw(text: string): void {
  process.stdout.write(text);
}

/** Print a status line (overwrites current line). */
export function status(message: string): void {
  process.stderr.write(`\r  ${GRAY}${message}${RESET}\x1b[K`);
}

/** Clear the status line. */
export function clearStatus(): void {
  process.stderr.write("\r\x1b[K");
}

/** Print a persistent tool activity line (clears any status first). */
export function toolActivity(description: string): void {
  process.stderr.write(`\r\x1b[K${ORANGE}> ${description}${RESET}\n`);
}

// ── Markdown streaming renderer ─────────────────────────────────────

/**
 * Stateful markdown renderer for streaming token-by-token output.
 *
 * Buffers incomplete lines so that inline markdown delimiters (like **)
 * are never split across render calls. Only emits output when a line
 * is complete (newline received) or on finalize().
 *
 * Handles: **bold**, *italic*, `inline code`, code blocks (```),
 * bullet lists, numbered lists, headings, and special blocks
 * (intent_proposal, opportunity).
 */
export class MarkdownRenderer {
  private buffer = "";
  private inCodeBlock = false;
  private codeBlockLang = "";
  private codeBlockContent = "";
  /** Whether we've emitted any content yet (for leading newline). */
  private pristine = true;

  /** Feed a new token into the renderer. */
  write(text: string): void {
    this.buffer += text;
    this.flush();
  }

  /** Process buffered content and render completed lines. */
  private flush(): void {
    while (this.buffer.length > 0) {
      if (this.inCodeBlock) {
        const endIdx = this.buffer.indexOf("```");
        if (endIdx !== -1) {
          this.codeBlockContent += this.buffer.slice(0, endIdx);
          this.buffer = this.buffer.slice(endIdx + 3);
          // Consume trailing newline after closing ```
          if (this.buffer.startsWith("\n")) {
            this.buffer = this.buffer.slice(1);
          }
          this.renderCodeBlock();
          this.inCodeBlock = false;
          this.codeBlockLang = "";
          this.codeBlockContent = "";
          continue;
        }
        // Haven't found closing ``` yet — buffer everything
        this.codeBlockContent += this.buffer;
        this.buffer = "";
        return;
      }

      // Check for code block opening — only at start of a line
      const codeBlockMatch = this.buffer.match(/^```([^\n]*)\n/);
      if (codeBlockMatch) {
        this.codeBlockLang = codeBlockMatch[1].trim();
        this.buffer = this.buffer.slice(codeBlockMatch[0].length);
        this.inCodeBlock = true;
        this.codeBlockContent = "";
        continue;
      }

      // If buffer starts with ``` but no newline yet, wait for more data
      if (this.buffer.startsWith("```")) {
        return;
      }

      // Only render complete lines — buffer the rest
      const nlIdx = this.buffer.indexOf("\n");
      if (nlIdx === -1) {
        // Incomplete line — wait for more tokens or finalize()
        return;
      }

      const line = this.buffer.slice(0, nlIdx);
      this.buffer = this.buffer.slice(nlIdx + 1);
      this.emitLine(line);
    }
  }

  /** Emit a formatted line to stdout. */
  private emitLine(line: string): void {
    if (this.pristine) {
      // Add a blank line before the response for spacing
      process.stdout.write("\n");
      this.pristine = false;
    }
    const rendered = this.renderLine(line);
    process.stdout.write(rendered + "\n");
  }

  /** Render a complete line with block-level formatting. */
  private renderLine(line: string): string {
    // Bullet list items
    const bulletMatch = line.match(/^(\s*)([-*])\s+(.*)$/);
    if (bulletMatch) {
      const [, indent, , content] = bulletMatch;
      return `${indent}  ${CYAN}*${RESET} ${this.renderInline(content)}`;
    }

    // Numbered list items
    const numMatch = line.match(/^(\s*)(\d+)\.\s+(.*)$/);
    if (numMatch) {
      const [, indent, num, content] = numMatch;
      return `${indent}  ${CYAN}${num}.${RESET} ${this.renderInline(content)}`;
    }

    // Headings
    if (line.startsWith("### ")) {
      return `${BOLD}${WHITE}${line.slice(4)}${RESET}`;
    }
    if (line.startsWith("## ")) {
      return `${BOLD}${WHITE}${line.slice(3)}${RESET}`;
    }
    if (line.startsWith("# ")) {
      return `${BOLD}${WHITE}${line.slice(2)}${RESET}`;
    }

    return this.renderInline(line);
  }

  /** Render inline markdown formatting to ANSI. */
  private renderInline(text: string): string {
    // Bold + italic (***text***)
    text = text.replace(/\*\*\*(.+?)\*\*\*/g, `${BOLD}${ITALIC}${WHITE}$1${RESET}${AGENT_TEXT}`);
    // Bold (**text**)
    text = text.replace(/\*\*(.+?)\*\*/g, `${BOLD}${WHITE}$1${RESET}${AGENT_TEXT}`);
    // Italic (*text*) — negative lookbehind/ahead for *
    text = text.replace(
      /(?<!\*)\*([^*]+?)\*(?!\*)/g,
      `${ITALIC}$1${RESET}${AGENT_TEXT}`,
    );
    // Inline code (`text`)
    text = text.replace(/`([^`]+)`/g, `${CYAN}$1${RESET}${AGENT_TEXT}`);

    return `${AGENT_TEXT}${text}${RESET}`;
  }

  /** Render a completed code block. */
  private renderCodeBlock(): void {
    const lang = this.codeBlockLang;
    const content = this.codeBlockContent.trimEnd();

    if (!this.pristine) {
      process.stdout.write("\n");
    }
    this.pristine = false;

    // Special block: intent_proposal
    if (lang === "intent_proposal") {
      this.renderIntentProposal(content);
      return;
    }

    // Special block: opportunity
    if (lang === "opportunity") {
      this.renderOpportunity(content);
      return;
    }

    // Regular code block
    const border = `${GRAY}|${RESET}`;
    if (lang) {
      process.stdout.write(`  ${GRAY}--- ${lang} ${"─".repeat(Math.max(0, 40 - lang.length))}${RESET}\n`);
    } else {
      process.stdout.write(`  ${GRAY}${"─".repeat(46)}${RESET}\n`);
    }
    for (const line of content.split("\n")) {
      process.stdout.write(`  ${border} ${CYAN}${line}${RESET}\n`);
    }
    process.stdout.write(`  ${GRAY}${"─".repeat(46)}${RESET}\n\n`);
  }

  /** Render an intent proposal as a styled card. */
  private renderIntentProposal(content: string): void {
    try {
      const data = JSON.parse(content) as {
        description?: string;
        confidence?: number;
        proposalId?: string;
      };

      const desc = data.description ?? content;
      const confidence = data.confidence;

      process.stdout.write(`  ${MAGENTA}+${"─".repeat(56)}+${RESET}\n`);
      process.stdout.write(`  ${MAGENTA}|${RESET} ${BOLD}${MAGENTA}Signal Proposal${RESET}${" ".repeat(40)}${MAGENTA}|${RESET}\n`);
      process.stdout.write(`  ${MAGENTA}|${RESET}${" ".repeat(56)}${MAGENTA}|${RESET}\n`);

      const wrapped = wordWrap(desc, 52);
      for (const line of wrapped) {
        const pad = Math.max(0, 54 - line.length);
        process.stdout.write(`  ${MAGENTA}|${RESET}  ${AGENT_TEXT}${line}${RESET}${" ".repeat(pad)}${MAGENTA}|${RESET}\n`);
      }

      if (confidence !== undefined) {
        process.stdout.write(`  ${MAGENTA}|${RESET}${" ".repeat(56)}${MAGENTA}|${RESET}\n`);
        const bar = confidenceBar(confidence);
        process.stdout.write(`  ${MAGENTA}|${RESET}  ${GRAY}Confidence: ${bar}${RESET}${" ".repeat(24)}${MAGENTA}|${RESET}\n`);
      }

      process.stdout.write(`  ${MAGENTA}+${"─".repeat(56)}+${RESET}\n\n`);
    } catch {
      process.stdout.write(`  ${GRAY}${content}${RESET}\n\n`);
    }
  }

  /** Render an opportunity block. */
  private renderOpportunity(content: string): void {
    try {
      const data = JSON.parse(content) as {
        title?: string;
        description?: string;
        users?: Array<{ name?: string }>;
      };

      process.stdout.write(`  ${BLUE}+${"─".repeat(56)}+${RESET}\n`);
      process.stdout.write(`  ${BLUE}|${RESET} ${BOLD}${BLUE}Opportunity${RESET}${" ".repeat(44)}${BLUE}|${RESET}\n`);

      if (data.title) {
        const pad = Math.max(0, 54 - data.title.length);
        process.stdout.write(`  ${BLUE}|${RESET}  ${BOLD}${data.title}${RESET}${" ".repeat(pad)}${BLUE}|${RESET}\n`);
      }

      if (data.description) {
        process.stdout.write(`  ${BLUE}|${RESET}${" ".repeat(56)}${BLUE}|${RESET}\n`);
        const wrapped = wordWrap(data.description, 52);
        for (const line of wrapped) {
          const pad = Math.max(0, 54 - line.length);
          process.stdout.write(`  ${BLUE}|${RESET}  ${AGENT_TEXT}${line}${RESET}${" ".repeat(pad)}${BLUE}|${RESET}\n`);
        }
      }

      process.stdout.write(`  ${BLUE}+${"─".repeat(56)}+${RESET}\n\n`);
    } catch {
      process.stdout.write(`  ${GRAY}${content}${RESET}\n\n`);
    }
  }

  /**
   * Reset the renderer state after a response_reset event.
   * Prints a visual separator so the user knows output was discarded.
   */
  reset(reason?: string): void {
    // Flush any partial content first
    if (this.buffer.length > 0 || this.inCodeBlock) {
      this.buffer = "";
      this.inCodeBlock = false;
      this.codeBlockContent = "";
      this.codeBlockLang = "";
    }
    if (!this.pristine) {
      process.stdout.write(`\n${GRAY}--- retrying${reason ? `: ${reason}` : ""} ---${RESET}\n`);
    }
    this.pristine = true;
  }

  /** Finalize — flush any remaining buffered content. */
  finalize(): void {
    if (this.inCodeBlock) {
      this.renderCodeBlock();
      this.inCodeBlock = false;
    }
    if (this.buffer.length > 0) {
      // Remaining partial line — render it now
      this.emitLine(this.buffer);
      this.buffer = "";
    }
  }
}

// ── Profile card ────────────────────────────────────────────────────

/** User data shape for profile card rendering. */
export interface ProfileData {
  id: string;
  name: string | null;
  intro: string | null;
  avatar: string | null;
  location: string | null;
  socials: Record<string, string> | null;
  isGhost: boolean;
  createdAt: string;
  updatedAt: string | null;
}

/**
 * Render a styled profile card and return it as a string.
 * Also prints the card to stdout.
 *
 * @param data - The user profile data.
 * @returns The rendered card string (with ANSI codes).
 */
export function profileCard(data: ProfileData): string {
  const lines: string[] = [];
  const W = 56;
  const border = (ch: string) => `${CYAN}${ch}${RESET}`;
  const hline = `  ${border("+")}${CYAN}${"─".repeat(W)}${RESET}${border("+")}`;

  lines.push("");
  lines.push(hline);

  // Name line
  const displayName = data.name ?? "(unnamed)";
  const ghostTag = data.isGhost ? `  ${YELLOW}[ghost]${RESET}` : "";
  const nameContent = `${BOLD}${WHITE}${displayName}${RESET}${ghostTag}`;
  lines.push(`  ${border("|")} ${nameContent}${padTo(W - 2, stripAnsi(displayName + (data.isGhost ? "  [ghost]" : "")))}${border("|")}`);

  // Intro / bio
  if (data.intro) {
    lines.push(`  ${border("|")}${" ".repeat(W)}${border("|")}`);
    const wrapped = wordWrap(data.intro, W - 4);
    for (const line of wrapped) {
      lines.push(`  ${border("|")}  ${AGENT_TEXT}${line}${RESET}${padTo(W - 2, line)}${border("|")}`);
    }
  }

  // Location
  if (data.location) {
    lines.push(`  ${border("|")}${" ".repeat(W)}${border("|")}`);
    const locLine = `Location: ${data.location}`;
    lines.push(`  ${border("|")}  ${GRAY}${locLine}${RESET}${padTo(W - 2, locLine)}${border("|")}`);
  }

  // Socials
  if (data.socials && Object.keys(data.socials).length > 0) {
    lines.push(`  ${border("|")}${" ".repeat(W)}${border("|")}`);
    for (const [platform, url] of Object.entries(data.socials)) {
      const socialLine = `${platform}: ${url}`;
      lines.push(`  ${border("|")}  ${BLUE}${socialLine}${RESET}${padTo(W - 2, socialLine)}${border("|")}`);
    }
  }

  // Member since
  const since = new Date(data.createdAt).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
  const sinceLine = `Member since ${since}`;
  lines.push(`  ${border("|")}${" ".repeat(W)}${border("|")}`);
  lines.push(`  ${border("|")}  ${DIM}${sinceLine}${RESET}${padTo(W - 2, sinceLine)}${border("|")}`);

  lines.push(hline);
  lines.push("");

  const output = lines.join("\n");
  console.log(output);
  return output;
}

/** Pad remaining space to fill a fixed-width card cell. */
function padTo(cellWidth: number, plainText: string): string {
  const remaining = Math.max(0, cellWidth - plainText.length);
  return " ".repeat(remaining);
}

/** Strip ANSI escape sequences from a string. */
function stripAnsi(str: string): string {
  return str.replace(/\x1b\[[0-9;]*m/g, "");
}

// ── Session table ───────────────────────────────────────────────────

/**
 * Print a table of sessions.
 */
export function sessionTable(
  sessions: Array<{ id: string; title: string | null; createdAt: string }>,
): void {
  if (sessions.length === 0) {
    dim("  No chat sessions found.");
    return;
  }

  const idWidth = 36;
  const titleWidth = 40;
  const dateWidth = 20;

  console.log(
    `  ${BOLD}${"ID".padEnd(idWidth)}  ${"Title".padEnd(titleWidth)}  ${"Created".padEnd(dateWidth)}${RESET}`,
  );
  console.log(`  ${GRAY}${"-".repeat(idWidth)}  ${"-".repeat(titleWidth)}  ${"-".repeat(dateWidth)}${RESET}`);

  for (const s of sessions) {
    const title = (s.title ?? "(untitled)").slice(0, titleWidth);
    const date = new Date(s.createdAt).toLocaleDateString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });

    console.log(
      `  ${GRAY}${s.id.padEnd(idWidth)}${RESET}  ${title.padEnd(titleWidth)}  ${GRAY}${date}${RESET}`,
    );
  }
}

// ── Intent output ──────────────────────────────────────────────────

import type { Intent } from "./api.client";

/**
 * Print a table of intents (user-facing: "signals").
 *
 * @param intents - Array of intent objects from the API.
 */
export function intentTable(intents: Intent[]): void {
  if (intents.length === 0) {
    dim("  No signals found.");
    return;
  }

  const descWidth = 50;
  const statusWidth = 10;
  const sourceWidth = 16;
  const dateWidth = 20;

  console.log(
    `  ${BOLD}${"Signal".padEnd(descWidth)}  ${"Status".padEnd(statusWidth)}  ${"Source".padEnd(sourceWidth)}  ${"Created".padEnd(dateWidth)}${RESET}`,
  );
  console.log(
    `  ${GRAY}${"-".repeat(descWidth)}  ${"-".repeat(statusWidth)}  ${"-".repeat(sourceWidth)}  ${"-".repeat(dateWidth)}${RESET}`,
  );

  for (const intent of intents) {
    const desc = (intent.summary ?? intent.payload).slice(0, descWidth);
    const status = (intent.status ?? "").padEnd(statusWidth);
    const source = (intent.sourceType ?? "-").padEnd(sourceWidth);
    const date = new Date(intent.createdAt).toLocaleDateString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
    });

    const statusColor = intent.status === "ACTIVE" ? GREEN : GRAY;
    console.log(
      `  ${desc.padEnd(descWidth)}  ${statusColor}${status}${RESET}  ${GRAY}${source}${RESET}  ${GRAY}${date}${RESET}`,
    );
  }
}

/**
 * Print a detailed card for a single intent (user-facing: "signal").
 *
 * @param intent - The intent object from the API.
 */
export function intentCard(intent: Intent): void {
  console.log();
  console.log(`  ${BOLD}${CYAN}Signal Details${RESET}`);
  console.log(`  ${GRAY}${"─".repeat(50)}${RESET}`);
  console.log(`  ${BOLD}ID${RESET}            ${GRAY}${intent.id}${RESET}`);
  console.log(`  ${BOLD}Status${RESET}        ${intent.status === "ACTIVE" ? GREEN : GRAY}${intent.status}${RESET}`);

  if (intent.summary) {
    console.log(`  ${BOLD}Summary${RESET}       ${intent.summary}`);
  }

  console.log();
  console.log(`  ${BOLD}Description${RESET}`);
  console.log(`  ${intent.payload}`);

  if (intent.speechActType) {
    console.log();
    console.log(`  ${BOLD}Speech Act${RESET}    ${intent.speechActType}`);
  }
  if (intent.intentMode) {
    console.log(`  ${BOLD}Mode${RESET}          ${intent.intentMode}`);
  }
  if (intent.sourceType) {
    console.log(`  ${BOLD}Source${RESET}        ${intent.sourceType}`);
  }
  if (intent.confidence !== undefined) {
    console.log(`  ${BOLD}Confidence${RESET}    ${confidenceBar(intent.confidence)}`);
  }
  if (intent.semanticEntropy !== undefined) {
    console.log(`  ${BOLD}Entropy${RESET}       ${intent.semanticEntropy.toFixed(2)}`);
  }
  if (intent.isIncognito) {
    console.log(`  ${BOLD}Incognito${RESET}     ${YELLOW}Yes${RESET}`);
  }

  console.log();
  console.log(`  ${BOLD}Created${RESET}       ${GRAY}${new Date(intent.createdAt).toLocaleString()}${RESET}`);
  console.log(`  ${BOLD}Updated${RESET}       ${GRAY}${new Date(intent.updatedAt).toLocaleString()}${RESET}`);
  if (intent.archivedAt) {
    console.log(`  ${BOLD}Archived${RESET}      ${GRAY}${new Date(intent.archivedAt).toLocaleString()}${RESET}`);
  }

  if (intent.indexes && intent.indexes.length > 0) {
    console.log();
    console.log(`  ${BOLD}Index Assignments${RESET}`);
    for (const idx of intent.indexes) {
      const score = idx.relevancyScore !== undefined ? ` (${idx.relevancyScore.toFixed(2)})` : "";
      console.log(`  ${CYAN}*${RESET} ${idx.title}${GRAY}${score}${RESET}`);
    }
  }

  console.log(`  ${GRAY}${"─".repeat(50)}${RESET}`);
  console.log();
}

// ── Tool descriptions ───────────────────────────────────────────────

/** Human-friendly descriptions for protocol tools (mirrors frontend). */
const TOOL_DESCRIPTIONS: Record<string, string> = {
  read_user_profiles: "Reading your profile...",
  create_user_profile: "Creating your profile...",
  update_user_profile: "Updating your profile...",
  read_intents: "Fetching your active signals...",
  create_intent: "Creating a new signal...",
  update_intent: "Updating signal...",
  delete_intent: "Removing signal...",
  create_intent_index: "Saving signal to index...",
  read_intent_indexes: "Fetching signals in index...",
  delete_intent_index: "Removing signal from index...",
  read_indexes: "Checking your indexes...",
  create_index: "Creating a new index...",
  update_index: "Updating index...",
  delete_index: "Deleting index...",
  create_index_membership: "Adding member to index...",
  read_index_memberships: "Fetching index memberships...",
  create_opportunities: "Searching for relevant connections...",
  list_my_opportunities: "Listing your opportunities...",
  update_opportunity: "Updating opportunity status...",
  scrape_url: "Reading content from URL...",
  read_docs: "Looking up documentation...",
  import_gmail_contacts: "Importing Gmail contacts...",
  import_contacts: "Importing contacts...",
  list_contacts: "Listing your contacts...",
  add_contact: "Adding contact...",
  remove_contact: "Removing contact...",
  send_opportunity: "Sending opportunity...",
};

/** Get a human-friendly description for a raw tool name. */
export function humanizeToolName(name: string): string {
  return TOOL_DESCRIPTIONS[name] ?? name.replace(/_/g, " ") + "...";
}

// ── Helpers ──────────────────────────────────────────────────────────

/** Word-wrap text to a maximum width. */
function wordWrap(text: string, maxWidth: number): string[] {
  const lines: string[] = [];
  const words = text.split(/\s+/);
  let current = "";

  for (const word of words) {
    if (current.length + word.length + 1 > maxWidth && current.length > 0) {
      lines.push(current);
      current = word;
    } else {
      current = current ? `${current} ${word}` : word;
    }
  }
  if (current) lines.push(current);
  return lines;
}

/** Render a confidence percentage as a small bar. */
function confidenceBar(confidence: number): string {
  const pct = Math.round(confidence);
  const filled = Math.round(pct / 10);
  const empty = 10 - filled;
  return `${GREEN}${"#".repeat(filled)}${GRAY}${"-".repeat(empty)}${RESET} ${GRAY}${pct}%`;
}
