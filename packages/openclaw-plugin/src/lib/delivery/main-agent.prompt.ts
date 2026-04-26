/**
 * Builds the prompt handed to the user's main OpenClaw agent when rendering an
 * Index Network notification. The shared skeleton is composed from clauses,
 * with the per-content-type instruction selected last. The `INPUT` block holds
 * the structured payload as JSON; the agent reads it directly.
 */

/** Controls whether the agent is allowed to invoke MCP tools during rendering. */
export type MainAgentToolUse = 'disabled' | 'enabled';

/** Identifies the notification content type being rendered. */
export type MainAgentContentType =
  | 'daily_digest'
  | 'ambient_discovery'
  | 'test_message';

/** A single discovered connection candidate surfaced to the main agent. */
export interface OpportunityCandidate {
  opportunityId: string;
  counterpartUserId: string;
  headline: string;
  personalizedSummary: string;
  suggestedAction: string;
  narratorRemark: string;
  profileUrl: string;
  acceptUrl: string;
  skipUrl: string;
}

/**
 * Structured payload delivered to the main agent. The shape varies by
 * `contentType`: digest/discovery payloads carry candidates; test payloads
 * carry a plain content string.
 */
export type MainAgentPayload =
  | {
      contentType: 'daily_digest' | 'ambient_discovery';
      maxToSurface: number;
      candidates: OpportunityCandidate[];
    }
  | {
      contentType: 'test_message';
      content: string;
    };

/** All inputs required to build the main-agent prompt. */
export interface MainAgentPromptInput {
  /** Selects the per-type instruction block. */
  contentType: MainAgentContentType;
  /** Whether the agent may call MCP tools while rendering. */
  mainAgentToolUse: MainAgentToolUse;
  /** When true, the `NO_REPLY` suppression clause is included. */
  allowSuppress: boolean;
  /** The structured payload that will be embedded as JSON in the INPUT block. */
  payload: MainAgentPayload;
}

/**
 * Builds the prompt string handed to the user's main OpenClaw agent for
 * rendering an Index Network notification.
 *
 * @param input - All parameters needed to construct the prompt.
 * @returns A multi-line prompt string ready for direct injection into the agent.
 */
export function buildMainAgentPrompt(input: MainAgentPromptInput): string {
  const lines: string[] = [
    'INDEX NETWORK NOTIFICATION',
    'You are speaking to the user in your own voice, on their active channel.',
    '',
    toolUseClause(input.mainAgentToolUse),
    '',
    URL_PRESERVATION_CLAUSE,
  ];

  if (input.allowSuppress) {
    lines.push('', NO_REPLY_CLAUSE);
  }

  lines.push('', perTypeInstruction(input));

  lines.push(
    '',
    '===== INPUT =====',
    JSON.stringify(input.payload, null, 2),
    '===== END INPUT =====',
  );

  return lines.join('\n');
}

const URL_PRESERVATION_CLAUSE = [
  'For any opportunity you decide to surface, include its acceptUrl and skipUrl exactly',
  "as given. Link the person's name to their profileUrl. Do not reword, shorten, or",
  'omit URLs. If you decide not to mention an opportunity, simply leave it out — do not',
  'output its data without an action link.',
].join('\n');

const NO_REPLY_CLAUSE = [
  'If this is a poor moment — user is mid-conversation on something else, has asked for',
  'quiet, or this feels mistimed — output exactly `NO_REPLY` as your entire reply. The',
  'runtime will suppress delivery; the items will roll over.',
].join('\n');

function toolUseClause(mode: MainAgentToolUse): string {
  if (mode === 'enabled') {
    return 'You may call Index Network MCP tools to enrich. Stay brief — the user is waiting.';
  }
  return 'Do not call any tools. Everything you need is in INPUT below.';
}

function perTypeInstruction(input: MainAgentPromptInput): string {
  const payload = input.payload;
  switch (payload.contentType) {
    case 'daily_digest': {
      const max = payload.maxToSurface;
      return [
        `Rank the candidates, pick up to ${max} to surface, render as a numbered digest in`,
        'your voice. The user is scanning at digest time. If none feel worth a digest today,',
        'NO_REPLY.',
      ].join('\n');
    }
    case 'ambient_discovery':
      return [
        'Real-time alert, not a digest. Surface only candidates worth interrupting for *right',
        'now*. If none qualify, NO_REPLY. Otherwise render briefly.',
      ].join('\n');
    case 'test_message':
      return 'Delivery verification. Render the content below in your voice. Do not suppress.';
  }
}
