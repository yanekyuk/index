import { ReactNode, createElement } from 'react';
import Link from 'next/link';

/**
 * Regex to match mention markup: @[Display Name](userId)
 * Captures: [1] display name, [2] user ID
 */
const MENTION_REGEX = /@\[([^\]]+)\]\(([^)]+)\)/g;

/**
 * Parse mention markup in text and convert to React elements with clickable links.
 * 
 * @param text - Text containing mention markup like @[Name](userId)
 * @returns Array of ReactNodes with mentions converted to profile links
 */
export function parseMentions(text: string): ReactNode[] {
  const parts: ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  // Reset regex state
  MENTION_REGEX.lastIndex = 0;

  while ((match = MENTION_REGEX.exec(text)) !== null) {
    // Add text before the match
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index));
    }

    const [, displayName, userId] = match;
    
    // Create a link element for the mention
    parts.push(
      createElement(
        Link,
        {
          key: `mention-${userId}-${match.index}`,
          href: `/u/${userId}`,
          className: 'text-black hover:underline font-medium',
        },
        `@${displayName}`
      )
    );

    lastIndex = match.index + match[0].length;
  }

  // Add remaining text after the last match
  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex));
  }

  // If no mentions found, return the original text
  if (parts.length === 0) {
    return [text];
  }

  return parts;
}

/**
 * Check if text contains any mentions
 */
export function hasMentions(text: string): boolean {
  MENTION_REGEX.lastIndex = 0;
  return MENTION_REGEX.test(text);
}

/**
 * Extract all mentioned user IDs from text
 */
export function extractMentionedUserIds(text: string): string[] {
  const userIds: string[] = [];
  let match: RegExpExecArray | null;
  
  MENTION_REGEX.lastIndex = 0;
  while ((match = MENTION_REGEX.exec(text)) !== null) {
    userIds.push(match[2]);
  }
  
  return userIds;
}

/**
 * Strip mention markup from text, keeping only the display names
 */
export function stripMentionMarkup(text: string): string {
  return text.replace(MENTION_REGEX, '@$1');
}

/**
 * Convert mention markup to markdown links for rendering with ReactMarkdown.
 * Converts @[Name](userId) to [@Name](/u/userId)
 */
export function mentionsToMarkdownLinks(text: string): string {
  return text.replace(MENTION_REGEX, '[@$1](/u/$2)');
}
