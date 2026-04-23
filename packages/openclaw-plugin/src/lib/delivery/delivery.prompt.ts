export type DeliveryContentType =
  | 'ambient_discovery'
  | 'daily_digest'
  | 'test_message'
  | 'negotiation_accept';

export type DeliveryChannel = 'telegram';

export function buildDispatcherPrompt(
  channel: DeliveryChannel,
  contentType: DeliveryContentType,
  content: string,
  frontendUrl?: string,
): string {
  return [
    'You are delivering a message to the user via their active OpenClaw gateway.',
    'Before delivering, scan your conversation history.',
    'If the same or highly similar content was already sent recently, skip it.',
    'Prioritize novelty — only deliver what adds new value to the user.',
    '',
    channelStyleBlock(channel, frontendUrl),
    '',
    contentTypeContextBlock(contentType),
    '',
    '===== CONTENT =====',
    content,
    '===== END CONTENT =====',
  ].join('\n');
}

function channelStyleBlock(channel: DeliveryChannel, frontendUrl?: string): string {
  if (channel === 'telegram') {
    const lines = [
      'CHANNEL: Telegram',
      'Format rules:',
      '- Use **bold** for opportunity headlines.',
      '- Keep messages concise and chat-friendly. No markdown tables.',
      '- Use [text](url) for hyperlinks — they render as tappable links in Telegram.',
    ];
    if (frontendUrl) {
      lines.push(
        `- Base URL for links: ${frontendUrl}`,
        '- For each opportunity that includes a userId, add these links:',
        `  • [View Profile](${frontendUrl}/u/{userId}) — replace {userId} with the actual user ID`,
        `  • [Start Chat ›](${frontendUrl}/u/{userId}/chat) — replace {userId} with the actual user ID`,
        '- Place links on their own line after the opportunity summary.',
      );
    }
    return lines.join('\n');
  }
  return `CHANNEL: ${channel}`;
}

function contentTypeContextBlock(contentType: DeliveryContentType): string {
  switch (contentType) {
    case 'ambient_discovery':
      return [
        'CONTENT TYPE: Real-time opportunity alert.',
        'Surface only signal-rich matches. For each opportunity include the headline,',
        'a one-sentence reason it\'s relevant, and the profile/chat links.',
        'Keep it to 2-3 lines per opportunity max.',
      ].join('\n');
    case 'daily_digest':
      return [
        'CONTENT TYPE: Daily digest of ranked opportunities.',
        'Present as a numbered list. For each entry: headline, one-sentence summary,',
        'and profile/chat links. Add a brief intro line (e.g. "Here are today\'s top opportunities:").',
      ].join('\n');
    case 'test_message':
      return 'CONTENT TYPE: Delivery verification message — relay faithfully as-is.';
    case 'negotiation_accept':
      return 'CONTENT TYPE: Negotiation outcome notification — one short natural sentence.';
    default:
      return `CONTENT TYPE: ${contentType satisfies never}`;
  }
}
