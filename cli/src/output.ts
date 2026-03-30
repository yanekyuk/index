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

import type { Intent, Opportunity, Conversation, ConversationMessage } from "./api.client";

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

    const sColor = intent.status === "ACTIVE" ? GREEN : GRAY;
    console.log(
      `  ${desc.padEnd(descWidth)}  ${sColor}${status}${RESET}  ${GRAY}${source}${RESET}  ${GRAY}${date}${RESET}`,
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

// ── Opportunity output ──────────────────────────────────────────────

/** Human-readable labels for valency roles with color. */
const ROLE_LABELS: Record<string, { label: string; color: string }> = {
  agent: { label: "Helper", color: GREEN },
  patient: { label: "Seeker", color: YELLOW },
  peer: { label: "Peer", color: CYAN },
};

/**
 * Get a colored role label for an actor's valency role.
 *
 * @param role - Valency role string (agent, patient, peer).
 * @returns Colored label string.
 */
function roleLabel(role?: string): string {
  const entry = role ? ROLE_LABELS[role] : undefined;
  if (!entry) return `${GRAY}Unknown${RESET}`;
  return `${entry.color}${entry.label}${RESET}`;
}

/**
 * Print a table of opportunities.
 *
 * @param opportunities - Array of opportunity objects.
 */
export function opportunityTable(opportunities: Opportunity[]): void {
  if (opportunities.length === 0) {
    dim("  No opportunities found.");
    return;
  }

  const nameW = 24;
  const catW = 20;
  const statusW = 10;
  const confW = 8;
  const dateW = 20;

  process.stdout.write(
    `  ${BOLD}${"Counterparty".padEnd(nameW)}  ${"Category".padEnd(catW)}  ${"Status".padEnd(statusW)}  ${"Conf".padEnd(confW)}  ${"Created".padEnd(dateW)}${RESET}\n`,
  );
  process.stdout.write(
    `  ${GRAY}${"-".repeat(nameW)}  ${"-".repeat(catW)}  ${"-".repeat(statusW)}  ${"-".repeat(confW)}  ${"-".repeat(dateW)}${RESET}\n`,
  );

  for (const opp of opportunities) {
    const name = (opp.counterpartName ?? "Unknown").slice(0, nameW);
    const category = (opp.interpretation?.category ?? "-").slice(0, catW);
    const st = opp.status.slice(0, statusW);
    const conf = opp.interpretation?.confidence != null ? `${opp.interpretation.confidence}%` : "-";
    const date = opp.createdAt
      ? new Date(opp.createdAt).toLocaleDateString("en-US", {
          year: "numeric",
          month: "short",
          day: "numeric",
        })
      : "-";

    process.stdout.write(
      `  ${name.padEnd(nameW)}  ${GRAY}${category.padEnd(catW)}${RESET}  ${statusColor(st)}${st.padEnd(statusW)}${RESET}  ${GRAY}${conf.padEnd(confW)}${RESET}  ${GRAY}${date.padEnd(dateW)}${RESET}\n`,
    );
  }
}

/**
 * Print a detailed opportunity card.
 *
 * @param opp - Opportunity object with full details.
 */
export function opportunityCard(opp: Opportunity): void {
  const width = 58;
  const innerWidth = width - 2;

  process.stdout.write(`\n  ${BLUE}+${"─".repeat(width)}+${RESET}\n`);
  process.stdout.write(`  ${BLUE}|${RESET} ${BOLD}${BLUE}Opportunity${RESET}${" ".repeat(innerWidth - 12)}${BLUE}|${RESET}\n`);
  process.stdout.write(`  ${BLUE}+${"─".repeat(width)}+${RESET}\n`);

  // Status and category
  const st = opp.status ?? "unknown";
  const category = opp.interpretation?.category ?? "Uncategorized";
  cardLine(`${BOLD}Status:${RESET}  ${statusColor(st)}${st}${RESET}`, innerWidth);
  cardLine(`${BOLD}Category:${RESET}  ${category}`, innerWidth);

  // Confidence
  if (opp.interpretation?.confidence != null) {
    const bar = confidenceBar(opp.interpretation.confidence);
    cardLine(`${BOLD}Confidence:${RESET}  ${bar}`, innerWidth);
  }

  // Parties
  if (opp.actors && opp.actors.length > 0) {
    process.stdout.write(`  ${BLUE}|${RESET}${" ".repeat(innerWidth)}${BLUE}|${RESET}\n`);
    cardLine(`${BOLD}Parties:${RESET}`, innerWidth);
    for (const actor of opp.actors) {
      const name = actor.name ?? actor.userId;
      const role = roleLabel(actor.role);
      cardLine(`  ${name}  ${role}`, innerWidth);
    }
  }

  // Reasoning
  if (opp.interpretation?.reasoning) {
    process.stdout.write(`  ${BLUE}|${RESET}${" ".repeat(innerWidth)}${BLUE}|${RESET}\n`);
    cardLine(`${BOLD}Reasoning:${RESET}`, innerWidth);
    const wrapped = wordWrap(opp.interpretation.reasoning, innerWidth - 4);
    for (const line of wrapped) {
      cardLine(`  ${AGENT_TEXT}${line}${RESET}`, innerWidth);
    }
  }

  // Presentation
  if (opp.presentation) {
    process.stdout.write(`  ${BLUE}|${RESET}${" ".repeat(innerWidth)}${BLUE}|${RESET}\n`);
    cardLine(`${BOLD}Presentation:${RESET}`, innerWidth);
    const wrapped = wordWrap(opp.presentation, innerWidth - 4);
    for (const line of wrapped) {
      cardLine(`  ${AGENT_TEXT}${line}${RESET}`, innerWidth);
    }
  }

  // Timestamps
  if (opp.createdAt) {
    process.stdout.write(`  ${BLUE}|${RESET}${" ".repeat(innerWidth)}${BLUE}|${RESET}\n`);
    const created = new Date(opp.createdAt).toLocaleString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
    cardLine(`${GRAY}Created: ${created}${RESET}`, innerWidth);
  }

  process.stdout.write(`  ${BLUE}+${"─".repeat(width)}+${RESET}\n\n`);
}

/** Print a line inside a card box. */
function cardLine(content: string, _innerWidth: number): void {
  process.stdout.write(`  ${BLUE}|${RESET} ${content}\n`);
}

/** Get ANSI color for an opportunity status. */
function statusColor(st: string): string {
  switch (st) {
    case "accepted":
      return GREEN;
    case "rejected":
      return RED;
    case "pending":
      return YELLOW;
    case "expired":
      return GRAY;
    default:
      return "";
  }
}

// ── Network output ─────────────────────────────────────────────────

/**
 * Print a table of networks.
 *
 * @param networks - Array of network objects to display.
 */
export function networkTable(
  networks: Array<{
    id: string;
    title: string;
    memberCount?: number;
    role?: string;
    joinPolicy?: string;
    createdAt?: string;
  }>,
): void {
  if (networks.length === 0) {
    dim("  No networks found.");
    return;
  }

  const titleW = 30;
  const membersW = 8;
  const roleW = 10;
  const policyW = 12;
  const dateW = 18;

  console.log(
    `  ${BOLD}${"Title".padEnd(titleW)}  ${"Members".padEnd(membersW)}  ${"Role".padEnd(roleW)}  ${"Join Policy".padEnd(policyW)}  ${"Created".padEnd(dateW)}${RESET}`,
  );
  console.log(
    `  ${GRAY}${"-".repeat(titleW)}  ${"-".repeat(membersW)}  ${"-".repeat(roleW)}  ${"-".repeat(policyW)}  ${"-".repeat(dateW)}${RESET}`,
  );

  for (const n of networks) {
    const title = n.title.slice(0, titleW);
    const members = String(n.memberCount ?? "-");
    const role = n.role ?? "member";
    const policy = (n.joinPolicy ?? "invite_only").replace("_", " ");
    const date = n.createdAt
      ? new Date(n.createdAt).toLocaleDateString("en-US", {
          year: "numeric",
          month: "short",
          day: "numeric",
        })
      : "-";

    console.log(
      `  ${title.padEnd(titleW)}  ${members.padEnd(membersW)}  ${role.padEnd(roleW)}  ${policy.padEnd(policyW)}  ${GRAY}${date}${RESET}`,
    );
  }
}

/**
 * Print a network detail card.
 *
 * @param network - Network object with details.
 */
export function networkCard(network: {
  id: string;
  title: string;
  prompt?: string | null;
  joinPolicy?: string;
  memberCount?: number;
  owner?: { name: string; email: string };
}): void {
  console.log();
  console.log(`  ${BOLD}${network.title}${RESET}`);
  console.log(`  ${GRAY}${"─".repeat(40)}${RESET}`);
  console.log(`  ${GRAY}ID:${RESET}          ${network.id}`);
  if (network.prompt) {
    console.log(`  ${GRAY}Prompt:${RESET}      ${network.prompt}`);
  }
  console.log(`  ${GRAY}Join Policy:${RESET} ${(network.joinPolicy ?? "invite_only").replace("_", " ")}`);
  console.log(`  ${GRAY}Members:${RESET}     ${network.memberCount ?? "-"}`);
  if (network.owner) {
    console.log(`  ${GRAY}Owner:${RESET}       ${network.owner.name} (${network.owner.email})`);
  }
  console.log();
}

/**
 * Print a table of network members.
 *
 * @param members - Array of member objects.
 */
export function memberTable(
  members: Array<{
    user: { name: string; email: string };
    permissions: string[];
    createdAt?: string;
  }>,
): void {
  if (members.length === 0) {
    dim("  No members found.");
    return;
  }

  const nameW = 24;
  const emailW = 30;
  const roleW = 10;
  const dateW = 18;

  console.log(
    `  ${BOLD}${"Name".padEnd(nameW)}  ${"Email".padEnd(emailW)}  ${"Role".padEnd(roleW)}  ${"Joined".padEnd(dateW)}${RESET}`,
  );
  console.log(
    `  ${GRAY}${"-".repeat(nameW)}  ${"-".repeat(emailW)}  ${"-".repeat(roleW)}  ${"-".repeat(dateW)}${RESET}`,
  );

  for (const m of members) {
    const name = m.user.name.slice(0, nameW);
    const email = m.user.email.slice(0, emailW);
    const role = m.permissions.includes("owner")
      ? "owner"
      : m.permissions.includes("admin")
        ? "admin"
        : "member";
    const date = m.createdAt
      ? new Date(m.createdAt).toLocaleDateString("en-US", {
          year: "numeric",
          month: "short",
          day: "numeric",
        })
      : "-";

    console.log(
      `  ${name.padEnd(nameW)}  ${email.padEnd(emailW)}  ${role.padEnd(roleW)}  ${GRAY}${date}${RESET}`,
    );
  }
}

// ── Conversation output ───────────────────────────────────────────

/**
 * Print a table of conversations.
 *
 * @param conversations - Array of conversation objects from the API.
 */
export function conversationTable(conversations: Conversation[]): void {
  if (conversations.length === 0) {
    dim("  No conversations found.");
    return;
  }

  const idWidth = 36;
  const participantsWidth = 40;
  const dateWidth = 20;

  console.log(
    `  ${BOLD}${"ID".padEnd(idWidth)}  ${"Participants".padEnd(participantsWidth)}  ${"Created".padEnd(dateWidth)}${RESET}`,
  );
  console.log(
    `  ${GRAY}${"-".repeat(idWidth)}  ${"-".repeat(participantsWidth)}  ${"-".repeat(dateWidth)}${RESET}`,
  );

  for (const c of conversations) {
    const names = c.participants
      .map((p) => p.user?.name ?? p.participantId)
      .join(", ")
      .slice(0, participantsWidth);
    const date = new Date(c.createdAt).toLocaleDateString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
    });

    console.log(
      `  ${GRAY}${c.id.padEnd(idWidth)}${RESET}  ${names.padEnd(participantsWidth)}  ${GRAY}${date}${RESET}`,
    );
  }
}

/**
 * Print a summary card for a conversation (used after DM get-or-create).
 *
 * @param conversation - The conversation object from the API.
 */
export function conversationCard(conversation: Conversation): void {
  console.log();
  console.log(`  ${BOLD}${CYAN}Conversation${RESET}`);
  console.log(`  ${GRAY}${"─".repeat(40)}${RESET}`);
  console.log(`  ${BOLD}ID${RESET}            ${GRAY}${conversation.id}${RESET}`);

  if (conversation.participants.length > 0) {
    const names = conversation.participants
      .map((p) => p.user?.name ?? p.participantId)
      .join(", ");
    console.log(`  ${BOLD}Participants${RESET}  ${names}`);
  }

  const date = new Date(conversation.createdAt).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
  console.log(`  ${BOLD}Created${RESET}       ${GRAY}${date}${RESET}`);
  console.log(`  ${GRAY}${"─".repeat(40)}${RESET}`);
  console.log();
}

/**
 * Print a list of messages in a conversation.
 *
 * @param messages - Array of message objects from the API.
 */
export function messageList(messages: ConversationMessage[]): void {
  if (messages.length === 0) {
    dim("  No messages found.");
    return;
  }

  for (const msg of messages) {
    const sender = msg.senderId ?? msg.role;
    const time = new Date(msg.createdAt).toLocaleTimeString("en-US", {
      hour: "2-digit",
      minute: "2-digit",
    });
    const date = new Date(msg.createdAt).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
    });
    const textParts = msg.parts
      .filter((p) => p.type === "text" && p.text)
      .map((p) => p.text)
      .join("");

    console.log(`  ${CYAN}${sender}${RESET}  ${GRAY}${date} ${time}${RESET}`);
    console.log(`  ${textParts}`);
    console.log();
  }
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
