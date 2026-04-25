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
): string {
  const lines = [
    'You are delivering a message to the user via their active OpenClaw gateway.',
    'Always deliver the content below — do not skip or suppress it.',
  ];

  lines.push(
    '',
    channelStyleBlock(channel),
    '',
    contentTypeContextBlock(contentType),
    '',
    '===== CONTENT =====',
    content,
    '===== END CONTENT =====',
  );

  return lines.join('\n');
}

function channelStyleBlock(channel: DeliveryChannel): string {
  if (channel === 'telegram') {
    return [
      'CHANNEL: Telegram (Markdown — the gateway converts to HTML automatically)',
      'Format rules:',
      '- Use **bold** for opportunity headlines.',
      '- Keep messages concise and chat-friendly. No markdown tables.',
      '- Use [text](url) for hyperlinks — they render as tappable links in Telegram.',
      '- Do NOT use raw HTML tags — they will be escaped and shown literally.',
      '- Preserve all markdown links from the content as-is. Do not construct, modify, or remove URLs.',
    ].join('\n');
  }
  return `CHANNEL: ${channel}`;
}

function contentTypeContextBlock(contentType: DeliveryContentType): string {
  switch (contentType) {
    case 'ambient_discovery':
      return [
        'CONTENT TYPE: Real-time opportunity alert.',
        'Surface only signal-rich matches. For each opportunity include the headline,',
        'a one-sentence reason it\'s relevant, and the action links from the content.',
        'Keep it to 2-3 lines per opportunity max.',
      ].join('\n');
    case 'daily_digest':
      return [
        'CONTENT TYPE: Daily digest of ranked opportunities.',
        'Present as a numbered list. For each entry: headline, one-sentence summary,',
        'and the action links from the content. Add a brief intro line (e.g. "Here are today\'s top opportunities:").',
      ].join('\n');
    case 'test_message':
      return [
        'CONTENT TYPE: Delivery verification message.',
        'Format the content using all the channel formatting rules above (bold headlines,',
        'markdown links, etc.) so the user can verify that rich formatting renders correctly.',
      ].join('\n');
    case 'negotiation_accept':
      return 'CONTENT TYPE: Negotiation outcome notification — one short natural sentence.';
    default:
      return `CONTENT TYPE: ${contentType satisfies never}`;
  }
}
