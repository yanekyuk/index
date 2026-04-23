export type DeliveryContentType =
  | 'ambient_discovery'
  | 'daily_digest'
  | 'test_message'
  | 'negotiation_accept';

export function buildDispatcherPrompt(
  channel: string,
  contentType: DeliveryContentType,
  content: string,
): string {
  return [
    'You are delivering a message to the user via their active OpenClaw gateway.',
    'Before delivering, scan your conversation history.',
    'If the same or highly similar content was already sent recently, skip it.',
    'Prioritize novelty — only deliver what adds new value to the user.',
    '',
    channelStyleBlock(channel),
    '',
    contentTypeContextBlock(contentType),
    '',
    '===== CONTENT =====',
    content,
    '===== END CONTENT =====',
  ].join('\n');
}

function channelStyleBlock(channel: string): string {
  if (channel === 'telegram') {
    return [
      'CHANNEL: Telegram',
      'Format: concise and chat-friendly, no markdown tables, use **bold** for headlines where appropriate.',
    ].join('\n');
  }
  return `CHANNEL: ${channel}`;
}

function contentTypeContextBlock(contentType: DeliveryContentType): string {
  switch (contentType) {
    case 'ambient_discovery':
      return 'CONTENT TYPE: Real-time ambient opportunity alert. Surface only signal-rich matches concisely.';
    case 'daily_digest':
      return 'CONTENT TYPE: Scheduled daily digest of ranked opportunities. Present as a structured summary.';
    case 'test_message':
      return 'CONTENT TYPE: Delivery verification message — relay faithfully as-is.';
    case 'negotiation_accept':
      return 'CONTENT TYPE: Negotiation outcome notification — one short natural sentence.';
  }
}
