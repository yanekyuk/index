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
  previewShieldUrl?: string,
): string {
  const lines = [
    'You are delivering a message to the user via their active OpenClaw gateway.',
    'Always deliver the content below — do not skip or suppress it.',
    'IMPORTANT: Do NOT call any tools — not to look up profiles, confirm deliveries, or read data.',
    'Everything you need is in the CONTENT block below. Format it and output it as text.',
  ];

  if (channel === 'telegram' && previewShieldUrl) {
    lines.push(
      '',
      `LINK PREVIEW SHIELD: Your output MUST begin with exactly this text (copy verbatim):`,
      `[​](${previewShieldUrl})`,
      'This invisible link captures Telegram\'s link preview so that action URLs below are not previewed.',
      'Place it on its own line before the intro text. Do not omit or modify it.',
    );
  }

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
      '- Use **bold** for headlines.',
      '- Keep messages concise and chat-friendly. No markdown tables.',
      '- Use [text](url) for hyperlinks — they render as tappable links in Telegram.',
      '- Do NOT use raw HTML tags — they will be escaped and shown literally.',
      '',
      'URL embedding rules:',
      '- The CONTENT block contains structured opportunity data with URLs.',
      '- Link the person\'s name to their profileUrl: e.g. [Myles](profileUrl)',
      '- Weave accept/skip into the text naturally: e.g. "[Connect](acceptUrl) · [Skip](skipUrl)"',
      '- Do NOT add separate link sections, raw URLs, or title-style "(url)" annotations.',
      '- Use the exact URLs from the structured data — do not modify or construct URLs.',
    ].join('\n');
  }
  return `CHANNEL: ${channel}`;
}

function contentTypeContextBlock(contentType: DeliveryContentType): string {
  switch (contentType) {
    case 'ambient_discovery':
      return [
        'CONTENT TYPE: Real-time opportunity alert.',
        'Start with a one-sentence intro that makes clear this is a real-time alert, e.g. "⚡ A new connection just surfaced."',
        'The content contains structured opportunity blocks with name, headline, summary, and URLs.',
        'For each opportunity, compose a concise message (2-3 lines max) weaving the URLs',
        'into natural text per the URL embedding rules above.',
      ].join('\n');
    case 'daily_digest':
      return [
        'CONTENT TYPE: Daily digest of ranked opportunities.',
        'Start with a one-sentence intro that makes clear this is a daily digest, e.g. "📋 Your daily digest is ready."',
        'The content contains structured opportunity blocks with name, headline, summary, and URLs.',
        'For each entry compose a concise message weaving the URLs',
        'into natural text per the URL embedding rules above. Use a numbered list.',
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
