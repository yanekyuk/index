/**
 * Pure presentation layer for opportunities.
 * Generates title, description, and CTA based on viewer context — no DB access.
 */

import type { Opportunity } from '../shared/interfaces/database.interface.js';
import { MINIMAL_MAIN_TEXT_MAX_CHARS } from "./opportunity.labels.js";

export interface OpportunityPresentation {
  title: string;
  description: string;
  callToAction: string;
}

export interface UserInfo {
  id: string;
  name: string;
  avatar: string | null;
}

/**
 * Generate presentation copy for an opportunity based on viewer context.
 * Pure function — no side effects, no database access.
 */
export function presentOpportunity(
  opp: Opportunity,
  viewerId: string,
  otherPartyInfo: UserInfo,
  introducerInfo: UserInfo | null,
  format: 'card' | 'email' | 'notification'
): OpportunityPresentation {
  const myActor = opp.actors.find((a) => a.userId === viewerId);
  const introducer = opp.actors.find((a) => a.role === 'introducer');

  if (!myActor) {
    throw new Error('Viewer is not an actor in this opportunity');
  }

  const otherName = otherPartyInfo.name;
  let title: string;
  let description: string;
  let descriptionIsReasoning = false;

  switch (myActor.role) {
    case 'agent':
      title = `You can help ${otherName}`;
      description = `Based on your expertise, ${otherName} might benefit from connecting with you.`;
      break;
    case 'patient':
      title = `${otherName} might be able to help you`;
      description = `${otherName} has skills that align with what you're looking for.`;
      break;
    case 'peer':
      title = `Potential collaboration with ${otherName}`;
      description = `You and ${otherName} have complementary interests.`;
      break;
    case 'mentee':
      title = `${otherName} could mentor you`;
      description = `${otherName} has experience that could help guide your journey.`;
      break;
    case 'mentor':
      title = `${otherName} is looking for guidance`;
      description = `Your expertise could help ${otherName} on their path.`;
      break;
    case 'founder':
      title = `${otherName} might be interested in your venture`;
      description = `${otherName}'s investment focus aligns with what you're building.`;
      break;
    case 'investor':
      title = `${otherName} is building something interesting`;
      description = `${otherName}'s venture might fit your investment thesis.`;
      break;
    case 'party':
    default:
      if (introducer && introducerInfo) {
        title = `${introducerInfo.name} thinks you should meet ${otherName}`;
        description = opp.interpretation.reasoning;
        descriptionIsReasoning = true;
      } else {
        title = `Opportunity with ${otherName}`;
        description = opp.interpretation.reasoning;
        descriptionIsReasoning = true;
      }
      break;
  }

  if (!descriptionIsReasoning) {
    description += `\n\n${opp.interpretation.reasoning}`;
  }

  if (format === 'notification') {
    description =
      description.length > 100 ? description.slice(0, 97) + '...' : description;
  }

  return {
    title,
    description,
    callToAction: 'View Opportunity',
  };
}

/**
 * Strips UUID patterns from user-facing text to prevent internal ID leaks.
 */

const UUID_PATTERN = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

export function stripUuids(text: string): string {
  return text
    .replace(/\(([^)]*)\)/g, (_match, inner: string) => {
      if (!UUID_PATTERN.test(inner)) {
        UUID_PATTERN.lastIndex = 0;
        return _match;
      }
      UUID_PATTERN.lastIndex = 0;
      const cleaned = inner
        .replace(UUID_PATTERN, '')
        .replace(/,\s*,/g, ',')
        .replace(/\b(?:from|and)\b/gi, '')
        .replace(/^[\s,]+|[\s,]+$/g, '');
      return cleaned ? `(${cleaned})` : '';
    })
    .replace(UUID_PATTERN, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

/**
 * Strips introducer mentions from opportunity summary text.
 * Removes patterns like:
 * - "[Introducer] introduced you to [Counterpart]"
 * - "[Introducer] thinks you should meet [Counterpart]"
 * - "[Introducer] connected you to [Counterpart]"
 * - "[Introducer] suggested you meet [Counterpart]"
 *
 * @param text - The text to clean (personalizedSummary)
 * @param introducerName - Full name of the introducer to strip
 * @returns Text with introducer mentions removed, counterpart preserved
 */
export function stripIntroducerMentions(
  text: string,
  introducerName: string | undefined,
): string {
  if (!introducerName?.trim()) return text;

  const fullName = introducerName.trim();
  const firstName = fullName.split(/\s+/)[0];
  const namesToCheck = [fullName];
  if (firstName && firstName.length > 1) {
    namesToCheck.push(firstName);
  }

  let result = text;

  for (const [idx, name] of namesToCheck.entries()) {
    const escapedName = escapeRegex(name);

    // Pattern: "Name introduced you to " (with or without comma, optionally with "directly")
    result = result.replace(
      new RegExp(`\\b${escapedName}\\s+introduced\\s+you\\s+(?:directly\\s+)?to\\s*`, "gi"),
      "",
    );

    // Pattern: "Name thinks you should meet "
    result = result.replace(
      new RegExp(`\\b${escapedName}\\s+thinks\\s+you\\s+should\\s+meet\\s*`, "gi"),
      "",
    );

    // Pattern: "Name connected you to "
    result = result.replace(
      new RegExp(`\\b${escapedName}\\s+connected\\s+you\\s+(?:to|with)\\s*`, "gi"),
      "",
    );

    // Pattern: "Name suggested you meet "
    result = result.replace(
      new RegExp(`\\b${escapedName}\\s+suggested\\s+you\\s+(?:meet|connect\\s+(?:to|with))\\s*`, "gi"),
      "",
    );

    // Pattern: "Name recommended you meet "
    result = result.replace(
      new RegExp(`\\b${escapedName}\\s+recommended\\s+you\\s+(?:meet|connect)\\s*`, "gi"),
      "",
    );

    // Pattern: "Name thinks you and Counterpart should meet" -> remove entire phrase up to Counterpart
    result = result.replace(
      new RegExp(`\\b${escapedName}\\s+thinks\\s+you\\s+and\\s+`, "gi"),
      "",
    );

    // Pattern: "Name also thought..." - remove sentences starting with Name + also/also thought
    result = result.replace(
      new RegExp(`\\b${escapedName}\\s+(?:also\\s+)?(?:thought|thinks?|believes?|felt)\\s*`, "gi"),
      "",
    );

    // General: Remove any remaining standalone mention of the introducer name at sentence start.
    // Only apply for fullName (idx === 0) to avoid stripping valid counterpart first names
    // (e.g. "David Smith" intro to "David Johnson" → we strip "David Smith" but not "David" in "David Johnson").
    if (idx === 0) {
      result = result.replace(
        new RegExp(`(?:^|\\.\\s*)\\b${escapedName}\\s+`, "gi"),
        (match, offset) => {
          if (offset === 0 || match.startsWith(".")) {
            return match.startsWith(".") ? ". " : "";
          }
          return match;
        },
      );
    }
  }

  // Clean up: remove leading/trailing whitespace and common punctuation artifacts
  result = result
    .replace(/^[\,\s]+/, "") // Remove leading commas/spaces
    .replace(/\s{2,}/g, " ") // Normalize multiple spaces
    .trim();

  // Capitalize first letter if we removed from start
  if (result.length > 0) {
    result = result.charAt(0).toUpperCase() + result.slice(1);
  }

  return result;
}

// Helper function
function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Viewer-centric text for opportunity cards.
 * The card is shown to the viewer (logged-in user) and should introduce the
 * counterpart, not describe the viewer to themselves.
 */

/**
 * Splits text into sentences using (?<=[.!?])\s+ (period/exclamation/question followed by whitespace).
 * Note: splits after any such punctuation, including abbreviations like "Dr." or "e.g.".
 */
function splitSentences(text: string): string[] {
  const trimmed = text.trim();
  if (!trimmed) return [];
  return trimmed
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Returns viewer-centric main text for an opportunity card.
 * Prefers the part of the reasoning that describes the counterpart (the person
 * on the card), so the viewer sees an introduction to the counterpart rather
 * than a description of themselves.
 *
 * @param reasoning - Raw interpretation.reasoning (may describe both parties).
 * @param counterpartName - Display name of the suggested connection (e.g. "Alex Chen").
 * @param maxChars - Max length of returned string (default MINIMAL_MAIN_TEXT_MAX_CHARS).
 * @param viewerName - Optional display name of the viewer (signed-in user). When provided, sentences or prefixes describing the viewer are skipped so the card introduces the counterpart, not the viewer.
 * @param introducerName - Optional display name of the introducer. When provided, introducer phrases (e.g., "X introduced you to...") are stripped from the summary to keep the body text focused on match quality.
 * @returns Viewer-centric snippet mentioning the counterpart when possible; if counterpartName is empty, returns reasoning truncated to maxChars. Never null; may be "A suggested connection." when reasoning is empty.
 */
export function viewerCentricCardSummary(
  reasoning: string,
  counterpartName: string,
  maxChars: number = MINIMAL_MAIN_TEXT_MAX_CHARS,
  viewerName?: string,
  introducerName?: string,
): string {
  const raw = stripUuids(reasoning);
  if (!raw) return "A suggested connection.";

  const name = counterpartName.trim();
  if (!name) {
    let out = raw.length <= maxChars ? raw : raw.slice(0, maxChars) + "...";
    // Strip introducer mentions before returning (keeps presenter input focused on the match).
    if (introducerName) {
      out = stripIntroducerMentions(out, introducerName);
    }
    return out;
  }

  const sentences = splitSentences(raw);
  const nameLower = name.toLowerCase();
  const firstWordOfName = name.split(/\s+/)[0]?.toLowerCase();
  const hasCounterpartName = (s: string) =>
    s.toLowerCase().includes(nameLower) ||
    (firstWordOfName && firstWordOfName.length > 1 && s.toLowerCase().includes(firstWordOfName));

  const viewer = viewerName?.trim().toLowerCase();
  const viewerFirstWord = viewerName?.trim().split(/\s+/)[0]?.toLowerCase();
  const startsWithViewer = (s: string) => {
    if (!viewer) return false;
    const sl = s.toLowerCase();
    return sl.startsWith(viewer) ||
      (viewerFirstWord && viewerFirstWord.length > 1 && sl.startsWith(viewerFirstWord));
  };

  // When viewerName is provided, prefer sentences that mention the counterpart
  // but do NOT start with the viewer's name.
  if (viewer) {
    // First pass: find a sentence that mentions counterpart and doesn't start with viewer
    const cleanIdx = sentences.findIndex(
      (s) => hasCounterpartName(s) && !startsWithViewer(s),
    );
    if (cleanIdx !== -1) {
      const result = sentences.slice(cleanIdx).join(" ").trim();
      let out = result.length <= maxChars ? result : result.slice(0, maxChars) + "...";
      // Strip introducer mentions before returning (keeps presenter input focused on the match).
      if (introducerName) {
        out = stripIntroducerMentions(out, introducerName);
      }
      return out;
    }

    // Second pass: sentence mentions counterpart but starts with viewer (compound sentence).
    // Try to extract the counterpart portion after the counterpart's name.
    const compoundIdx = sentences.findIndex(
      (s) => hasCounterpartName(s) && startsWithViewer(s),
    );
    if (compoundIdx !== -1) {
      const sentence = sentences[compoundIdx];
      // Find where the counterpart name appears and extract from there
      // Use case-insensitive Unicode-aware regex so the index is correct
      // even when toLowerCase() changes string length (e.g. Turkish İ→i, German ß→ss).
      const cpMatch = sentence.match(new RegExp(escapeRegex(name), "iu"));
      const cpIdx = cpMatch?.index ?? -1;
      if (cpIdx > 0) {
        const extracted = sentence.slice(cpIdx).trim();
        const rest = sentences.slice(compoundIdx + 1).join(" ").trim();
        const result = rest ? `${extracted} ${rest}` : extracted;
        let out = result.length <= maxChars ? result : result.slice(0, maxChars) + "...";
        // Strip introducer mentions before returning (keeps presenter input focused on the match).
        if (introducerName) {
          out = stripIntroducerMentions(out, introducerName);
        }
        return out;
      }
    }
  }

  // Fallback: original logic without viewer awareness
  const idx = sentences.findIndex(hasCounterpartName);
  if (idx === -1) {
    let out = raw.length <= maxChars ? raw : raw.slice(0, maxChars) + "...";
    // Strip introducer mentions before returning (keeps presenter input focused on the match).
    if (introducerName) {
      out = stripIntroducerMentions(out, introducerName);
    }
    return out;
  }

  const fromCounterpart = sentences.slice(idx).join(" ").trim();
  let out =
    fromCounterpart.length <= maxChars
      ? fromCounterpart
      : fromCounterpart.slice(0, maxChars) + "...";
      // Strip introducer mentions before returning (keeps presenter input focused on the match).
  if (introducerName) {
    out = stripIntroducerMentions(out, introducerName);
  }
  return out;
}
